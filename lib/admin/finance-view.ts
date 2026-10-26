import type { OrderPaymentStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { formatPrice, koboToNairaString } from "@/lib/money";
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS, PROVIDER_LABELS } from "@/lib/orders/labels";
import { PAYOUT_STATUS_LABELS } from "@/lib/payouts/seller-view";
import { refundedSoFar } from "@/lib/refunds/core";
import { paidOnline, REASON_LABELS } from "@/lib/refunds/math";
import { loadDispute, summariseRefund, type DisputeView, type RefundSummary } from "@/lib/refunds/view";

/** TownMart's orders, disputes, refunds and payouts screens. Admin-scope transactions. */

export const ORDER_TABS = { disputes: "Open disputes", waiting: "Refunds waiting", failed: "Failed refunds", recent: "Recent orders" } as const;
export type OrderTab = keyof typeof ORDER_TABS;

export type AdminQueueRow = { key: string; href: string; title: string; detail: string; amount: string; badge: string; tone: "warning" | "danger" | "info" | "secondary" | "success"; at: string };

export async function adminOrderQueue(tx: Tx, tab: OrderTab, q: string, now = new Date()) {
  const counts = {
    disputes: await tx.dispute.count({ where: { status: "open" } }),
    waiting: await tx.refund.count({ where: { status: "requested" } }),
    failed: await tx.refund.count({ where: { status: "failed" } }),
    recent: 0,
  };
  let rows: AdminQueueRow[] = [];
  if (q) {
    const term = q.trim();
    const orders = await tx.order.findMany({
      where: { OR: [{ orderNumber: { equals: term.toUpperCase() } }, { contactEmail: { equals: term.toLowerCase() } }, { customerName: { contains: term, mode: "insensitive" } }] },
      orderBy: { placedAt: "desc" },
      take: 50,
      select: { orderNumber: true, customerName: true, contactEmail: true, totalKobo: true, paymentStatus: true, placedAt: true },
    });
    rows = orders.map(orderRow);
  } else if (tab === "disputes") {
    const ds = await tx.dispute.findMany({ where: { status: "open" }, orderBy: { createdAt: "asc" }, take: 100, include: { business: { select: { name: true } }, sellerOrder: { select: { order: { select: { orderNumber: true, customerName: true } } } } } });
    rows = ds.map((d) => ({
      key: d.id,
      href: `/admin/disputes/${d.id}`,
      title: `${d.sellerOrder.order.orderNumber} · ${d.sellerOrder.order.customerName} vs ${d.business.name}`,
      detail: d.reason,
      amount: "",
      badge: `Opened by ${d.openedByParty === "customer" ? "customer" : "TownMart"}`,
      tone: "warning",
      at: formatDateTime(d.createdAt),
    }));
  } else if (tab === "waiting" || tab === "failed") {
    const rs = await tx.refund.findMany({
      where: { status: tab === "waiting" ? "requested" : "failed" },
      orderBy: tab === "waiting" ? { respondBy: "asc" } : { updatedAt: "desc" },
      take: 100,
      include: { business: { select: { name: true } }, order: { select: { orderNumber: true, customerName: true } } },
    });
    rows = rs.map((r) => ({
      key: r.id,
      href: `/admin/orders/${r.order.orderNumber}#refund-${r.id}`,
      title: `${r.refundNumber} · ${r.order.orderNumber} · ${r.business?.name ?? "TownMart"}`,
      detail: tab === "failed" ? (r.lastError ?? "The provider didn't confirm it") : `${REASON_LABELS[r.reason]} · ${r.order.customerName}`,
      amount: formatPrice(tab === "waiting" ? r.requestedKobo : r.amountKobo + r.feeKobo + r.vatKobo),
      badge: tab === "failed" ? `Failed after ${r.attempts} tr${r.attempts === 1 ? "y" : "ies"}` : r.respondBy && r.respondBy < now ? "Seller is late" : `Seller answers by ${r.respondBy ? formatDateTime(r.respondBy) : "—"}`,
      tone: tab === "failed" || (r.respondBy && r.respondBy < now) ? "danger" : "info",
      at: formatDateTime(r.createdAt),
    }));
  } else {
    const orders = await tx.order.findMany({ where: { paymentStatus: { not: "unpaid" } }, orderBy: { placedAt: "desc" }, take: 50, select: { orderNumber: true, customerName: true, contactEmail: true, totalKobo: true, paymentStatus: true, placedAt: true } });
    rows = orders.map(orderRow);
  }
  return { counts, rows };
}

function orderRow(o: { orderNumber: string; customerName: string; contactEmail: string; totalKobo: bigint; paymentStatus: OrderPaymentStatus; placedAt: Date }): AdminQueueRow {
  return {
    key: o.orderNumber,
    href: `/admin/orders/${o.orderNumber}`,
    title: `${o.orderNumber} · ${o.customerName}`,
    detail: o.contactEmail,
    amount: formatPrice(o.totalKobo),
    badge: PAYMENT_STATUS_LABELS[o.paymentStatus],
    tone: o.paymentStatus === "refunded" || o.paymentStatus === "partially_refunded" ? "warning" : o.paymentStatus === "paid" ? "success" : "secondary",
    at: formatDateTime(o.placedAt),
  };
}

export type AdminOrderView = {
  orderNumber: string;
  placedAt: string;
  customer: string;
  email: string;
  payment: string;
  total: string;
  serviceFee: string;
  refunded: string;
  sellers: {
    id: string;
    shop: string;
    status: string;
    payOnDelivery: boolean;
    paid: string;
    left: string;
    leftNaira: string;
    escrow: string;
    items: { orderItemId: string; title: string; qty: string; product: boolean }[];
    refunds: RefundSummary[];
    /** Refund requests waiting, for approving on the seller's behalf. */
    waiting: { id: string; number: string; maxNaira: string; items: { orderItemId: string; title: string; qty: string; product: boolean }[] }[];
    dispute: { id: string; status: string } | null;
  }[];
  /** Refunds of payments that couldn't be used (no seller). */
  otherRefunds: RefundSummary[];
};

export async function loadAdminOrder(tx: Tx, orderNumber: string): Promise<AdminOrderView | null> {
  const o = await tx.order.findUnique({
    where: { orderNumber },
    include: {
      sellerOrders: { orderBy: { createdAt: "asc" }, include: { business: { select: { name: true } }, items: { orderBy: { createdAt: "asc" }, select: { id: true, snapshot: true, qty: true, productId: true } } } },
      refunds: { orderBy: { createdAt: "desc" }, include: { items: { include: { orderItem: { select: { snapshot: true, productId: true } } } } } },
    },
  });
  if (!o) return null;
  const owed = o.refunds.filter((r) => ["approved", "processing", "completed", "failed"].includes(r.status)).reduce((a, r) => a + r.amountKobo + r.feeKobo + r.vatKobo, 0n);
  const sellers: AdminOrderView["sellers"] = [];
  for (const so of o.sellerOrders) {
    if (so.status === "pending_payment") continue;
    const before = await refundedSoFar(tx, so.id);
    const left = so.payOnDelivery ? 0n : paidOnline(so) - before.amountKobo;
    const dispute = await tx.dispute.findFirst({ where: { sellerOrderId: so.id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
    const mine = o.refunds.filter((r) => r.sellerOrderId === so.id);
    sellers.push({
      id: so.id,
      shop: so.business.name,
      status: ORDER_STATUS_LABELS[so.status],
      payOnDelivery: so.payOnDelivery,
      paid: formatPrice(so.payOnDelivery ? 0n : paidOnline(so)),
      left: formatPrice(left),
      leftNaira: koboToNairaString(left),
      escrow: so.payOnDelivery ? "Pay on delivery" : so.escrowReleasedAt ? `Released ${formatDateTime(so.escrowReleasedAt)}` : so.escrowReleaseAt ? `Held until ${formatDateTime(so.escrowReleaseAt)}` : "Held until delivery",
      items: so.items.map((i) => ({ orderItemId: i.id, title: (i.snapshot as { title: string }).title, qty: i.qty.toString(), product: !!i.productId })),
      refunds: mine.map(summariseRefund),
      waiting: mine
        .filter((r) => r.status === "requested")
        .map((r) => ({
          id: r.id,
          number: r.refundNumber,
          maxNaira: koboToNairaString(r.requestedKobo < left ? r.requestedKobo : left),
          items: r.items.map((i) => ({ orderItemId: i.orderItemId, title: (i.orderItem.snapshot as { title: string }).title, qty: i.qty.toString(), product: !!i.orderItem.productId })),
        })),
      dispute: dispute ? { id: dispute.id, status: dispute.status } : null,
    });
  }
  return {
    orderNumber: o.orderNumber,
    placedAt: formatDateTime(o.placedAt),
    customer: o.customerName,
    email: o.contactEmail,
    payment: `${PAYMENT_STATUS_LABELS[o.paymentStatus]} · ${PROVIDER_LABELS[o.paymentMethod]}`,
    total: formatPrice(o.totalKobo),
    serviceFee: formatPrice(o.serviceFeeKobo + o.vatKobo),
    refunded: formatPrice(owed),
    sellers,
    otherRefunds: o.refunds.filter((r) => !r.sellerOrderId).map(summariseRefund),
  };
}

export type AdminDisputeView = {
  dispute: DisputeView;
  orderNumber: string;
  customer: string;
  shop: string;
  payOnDelivery: boolean;
  left: string;
  leftNaira: string;
  refunds: RefundSummary[];
};

export async function loadAdminDispute(tx: Tx, id: string): Promise<AdminDisputeView | null> {
  const d = await tx.dispute.findUnique({ where: { id }, include: { business: { select: { name: true } }, sellerOrder: { include: { order: { select: { orderNumber: true, customerName: true } } } } } });
  if (!d) return null;
  const so = d.sellerOrder;
  const before = await refundedSoFar(tx, so.id);
  const left = so.payOnDelivery ? 0n : paidOnline(so) - before.amountKobo;
  const refunds = await tx.refund.findMany({ where: { sellerOrderId: so.id }, orderBy: { createdAt: "desc" }, include: { items: { include: { orderItem: { select: { snapshot: true } } } } } });
  return {
    dispute: (await loadDispute(tx, { id }))!,
    orderNumber: so.order.orderNumber,
    customer: so.order.customerName,
    shop: d.business.name,
    payOnDelivery: so.payOnDelivery,
    left: formatPrice(left),
    leftNaira: koboToNairaString(left),
    refunds: refunds.map(summariseRefund),
  };
}

export type MoneyOverview = {
  platform: { label: string; balance: string }[];
  trialBalanceOk: boolean;
  escrowDue: number;
  payouts: { id: string; shop: string; amount: string; status: string; tone: "info" | "success" | "danger"; bank: string; reference: string; at: string; failureReason: string | null }[];
  failedRefunds: { id: string; number: string; orderNumber: string; amount: string; error: string; at: string }[];
};

const PLATFORM_LABELS: Record<string, string> = {
  "platform:commission": "Commission earned",
  "platform:fees": "Service fees earned",
  "platform:tax": "VAT collected (to remit)",
  "platform:promotions": "TownMart-funded discounts",
  "platform:refunds": "Refunds owed to customers",
};

export async function moneyOverview(tx: Tx, now = new Date()): Promise<MoneyOverview> {
  const sums = await tx.$queryRaw<{ owner_type: string; owner_key: string; type: string; credit: bigint; debit: bigint }[]>`
    SELECT a.owner_type::text, a.owner_key, a.type::text, coalesce(sum(e.credit_kobo), 0)::bigint AS credit, coalesce(sum(e.debit_kobo), 0)::bigint AS debit
      FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.owner_type, a.owner_key, a.type`;
  const totalCredit = sums.reduce((a, s) => a + s.credit, 0n);
  const totalDebit = sums.reduce((a, s) => a + s.debit, 0n);
  const platform: MoneyOverview["platform"] = [];
  const escrow = sums.filter((s) => s.owner_type === "business" && s.type === "escrow").reduce((a, s) => a + s.credit - s.debit, 0n);
  const available = sums.filter((s) => s.owner_type === "business" && s.type === "available").reduce((a, s) => a + s.credit - s.debit, 0n);
  platform.push({ label: "Sellers' money held in escrow", balance: formatPrice(escrow) });
  platform.push({ label: "Sellers' available balances", balance: formatPrice(available) });
  for (const s of sums.filter((x) => x.owner_type === "platform")) {
    const label = PLATFORM_LABELS[`platform:${s.type}`] ?? s.type;
    platform.push({ label, balance: formatPrice(s.type === "promotions" ? s.debit - s.credit : s.credit - s.debit) });
  }
  for (const s of sums.filter((x) => x.owner_type === "provider_clearing")) {
    platform.push({ label: `Held at ${PROVIDER_LABELS[s.owner_key as keyof typeof PROVIDER_LABELS] ?? s.owner_key}`, balance: formatPrice(s.debit - s.credit) });
  }
  const escrowDue = await tx.sellerOrder.count({ where: { escrowReleasedAt: null, escrowReleaseAt: { lte: now }, OR: [{ payOnDelivery: false }, { cashCollectedAt: { not: null } }] } });
  const payouts = await tx.payout.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { business: { select: { name: true } } } });
  const failed = await tx.refund.findMany({ where: { status: "failed" }, orderBy: { updatedAt: "desc" }, take: 50, include: { order: { select: { orderNumber: true } } } });
  return {
    platform,
    trialBalanceOk: totalCredit === totalDebit,
    escrowDue,
    payouts: payouts.map((p) => ({
      id: p.id,
      shop: p.business.name,
      amount: formatPrice(p.amountKobo),
      status: PAYOUT_STATUS_LABELS[p.status],
      tone: p.status === "paid" ? "success" : p.status === "failed" ? "danger" : "info",
      bank: `${p.bankName} ••••${p.accountNumberLast4}`,
      reference: p.reference,
      at: formatDateTime(p.createdAt),
      failureReason: p.failureReason,
    })),
    failedRefunds: failed.map((r) => ({ id: r.id, number: r.refundNumber, orderNumber: r.order.orderNumber, amount: formatPrice(r.amountKobo + r.feeKobo + r.vatKobo), error: r.lastError ?? "Not confirmed by the provider", at: formatDateTime(r.updatedAt) })),
  };
}

