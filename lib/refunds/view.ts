import type { DisputeParty, RefundStatus } from "@prisma/client";
import { formatDate, formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { OUTCOME_LABELS } from "@/lib/disputes/core";
import { formatPrice } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/orders/labels";
import { OWED, refundedSoFar } from "./core";
import { paidOnline, REASON_LABELS, returnWindow, STATUS_LABELS } from "./math";

export const PARTY_LABELS: Record<DisputeParty, string> = { customer: "Customer", seller: "Seller", admin: "TownMart", system: "TownMart" };

export type RefundSummary = {
  id: string;
  number: string;
  status: RefundStatus;
  statusLabel: string;
  reason: string;
  total: string;
  requested: string;
  details: string | null;
  response: string | null;
  createdAt: string;
  decidedAt: string | null;
  completedAt: string | null;
  respondBy: string | null;
  items: { title: string; qty: string; restocked: boolean }[];
  evidence: number;
  origin: string;
};

type RefundRow = Awaited<ReturnType<typeof loadRefunds>>[number];

async function loadRefunds(tx: Tx, where: { sellerOrderId: string } | { orderId: string }) {
  return tx.refund.findMany({ where, orderBy: { createdAt: "desc" }, include: { items: { include: { orderItem: { select: { snapshot: true } } } } } });
}

export function summariseRefund(r: RefundRow): RefundSummary {
  const owed = (OWED as string[]).includes(r.status);
  return {
    id: r.id,
    number: r.refundNumber,
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    reason: REASON_LABELS[r.reason],
    total: formatPrice(owed ? r.amountKobo + r.feeKobo + r.vatKobo : r.requestedKobo),
    requested: formatPrice(r.requestedKobo),
    details: r.details,
    response: r.response,
    createdAt: formatDateTime(r.createdAt),
    decidedAt: r.decidedAt ? formatDateTime(r.decidedAt) : null,
    completedAt: r.completedAt ? formatDateTime(r.completedAt) : null,
    respondBy: r.status === "requested" && r.respondBy ? formatDateTime(r.respondBy) : null,
    items: r.items.map((i) => ({ title: (i.orderItem.snapshot as { title: string }).title, qty: i.qty.toString(), restocked: i.restock })),
    evidence: r.evidenceKeys.length,
    origin: r.origin,
  };
}

export type DisputeView = {
  id: string;
  status: "open" | "resolved" | "closed";
  outcome: string | null;
  reason: string;
  openedAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  refundNumber: string | null;
  messages: { id: string; from: string; party: DisputeParty; body: string; at: string }[];
};

export async function loadDispute(tx: Tx, where: { id: string } | { sellerOrderId: string }): Promise<DisputeView | null> {
  const d = await tx.dispute.findFirst({
    where: "id" in where ? { id: where.id } : { sellerOrderId: where.sellerOrderId },
    orderBy: { createdAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" } }, refund: { select: { refundNumber: true } } },
  });
  if (!d) return null;
  return {
    id: d.id,
    status: d.status,
    outcome: d.outcome ? OUTCOME_LABELS[d.outcome] : null,
    reason: d.reason,
    openedAt: formatDateTime(d.createdAt),
    resolvedAt: d.resolvedAt ? formatDateTime(d.resolvedAt) : null,
    resolutionNote: d.resolutionNote,
    refundNumber: d.refund?.refundNumber ?? null,
    messages: d.messages.map((m) => ({ id: m.id, from: PARTY_LABELS[m.sender], party: m.sender, body: m.body, at: formatDateTime(m.createdAt) })),
  };
}

export type HelpView = {
  orderNumber: string;
  sellerOrderId: string;
  shopName: string;
  status: string;
  payOnDelivery: boolean;
  isBooking: boolean;
  paid: string;
  left: string;
  items: { id: string; title: string; options: string; qty: number; refundable: number; unitPaid: string; perishable: boolean; windowOpen: boolean }[];
  refunds: RefundSummary[];
  dispute: DisputeView | null;
  canCancel: boolean;
  request: { allowed: true; closesAt: string | null } | { allowed: false; why: string };
  canDispute: { allowed: boolean; refundId: string | null };
};

/**
 * Everything the customer can see and do about one seller's part of their
 * order: refunds so far, a dispute, and whether they can cancel, ask for a
 * refund or ask TownMart to decide. The caller has checked the order is theirs.
 */
export async function loadHelp(tx: Tx, orderId: string, sellerOrderId: string, now = new Date()): Promise<HelpView | null> {
  const so = await tx.sellerOrder.findFirst({
    where: { id: sellerOrderId, orderId },
    include: {
      order: { select: { orderNumber: true, paymentStatus: true } },
      business: { select: { name: true, policy: { select: { returnWindowDays: true } } } },
      items: { orderBy: { createdAt: "asc" }, include: { booking: { select: { balanceKobo: true, startsAt: true, status: true } } } },
    },
  });
  if (!so || so.status === "pending_payment") return null;
  const products = await tx.product.findMany({ where: { id: { in: so.items.map((i) => i.productId).filter((x): x is string => !!x) } }, select: { id: true, isPerishable: true } });
  const perishable = new Set(products.filter((p) => p.isPerishable).map((p) => p.id));
  const before = await refundedSoFar(tx, so.id);
  const refunds = (await loadRefunds(tx, { sellerOrderId: so.id })).map(summariseRefund);
  const dispute = await loadDispute(tx, { sellerOrderId: so.id });
  const windowDays = so.business.policy?.returnWindowDays ?? 7;
  const paidOnlineOrder = so.order.paymentStatus === "paid" || so.order.paymentStatus === "partially_refunded";
  const left = so.payOnDelivery ? 0n : paidOnline(so) - before.amountKobo;
  const isBooking = so.deliveryMethod === "none";

  const items = so.items.map((i) => {
    const s = i.snapshot as { title: string; options?: Record<string, string> };
    const per = !!i.productId && perishable.has(i.productId);
    const done = before.items.get(i.id)?.qty ?? 0;
    const w = returnWindow({ deliveredAt: so.deliveredAt, windowDays, perishable: per, now });
    const paidLine = i.lineTotalKobo - (i.booking?.balanceKobo ?? 0n);
    return {
      id: i.id,
      title: s.title,
      options: Object.values(s.options ?? {}).join(", "),
      qty: Number(i.qty),
      refundable: Math.max(0, Number(i.qty) - done),
      unitPaid: formatPrice(paidLine / BigInt(Math.max(1, Math.round(Number(i.qty))))),
      perishable: per,
      windowOpen: w.open,
    };
  });

  const openRequest = refunds.some((r) => r.status === "requested");
  const goodsReady = ["shipped", "ready_for_pickup", "delivered", "completed"].includes(so.status);
  const bookingHappened = isBooking && so.items.some((i) => i.booking && i.booking.startsAt <= now && ["confirmed", "in_progress", "completed", "no_show"].includes(i.booking.status));
  let request: HelpView["request"];
  if (so.payOnDelivery) request = { allowed: false, why: "You paid the seller directly, so refunds are between you and them. Message them, or ask TownMart to step in." };
  else if (!paidOnlineOrder && so.order.paymentStatus !== "refunded") request = { allowed: false, why: "This order hasn't been paid for." };
  else if (left <= 0n) request = { allowed: false, why: "Everything in this part of the order has been refunded." };
  else if (openRequest) request = { allowed: false, why: "Your refund request is waiting for the seller's answer." };
  else if (dispute?.status === "open") request = { allowed: false, why: "TownMart is looking into this part of your order. Add anything new to the dispute above." };
  else if (!isBooking && (so.status === "paid" || so.status === "processing")) {
    request = { allowed: false, why: so.status === "paid" ? "The seller hasn't started on it yet: you can cancel it for a full refund." : "The seller is preparing it. Message them if you want to cancel: they can cancel it with a full refund." };
  } else if (isBooking && !bookingHappened) request = { allowed: false, why: "Cancel or move the booking from your order page. What you get back follows the Refund Policy." };
  else if (!isBooking && !goodsReady) request = { allowed: false, why: "This part of the order can't be refunded here." };
  else if (!items.some((i) => i.refundable > 0)) request = { allowed: false, why: "Every item in this part of the order has been refunded or decided." };
  else if (!items.some((i) => i.refundable > 0 && i.windowOpen)) {
    const closes = so.deliveredAt ? new Date(so.deliveredAt.getTime() + windowDays * 86_400_000) : null;
    request = { allowed: false, why: `The time to ask for a return has passed${closes ? ` (${formatDate(closes)})` : ""}. If something's wrong, you can still ask TownMart to look into it.` };
  } else {
    request = { allowed: true, closesAt: so.deliveredAt ? formatDate(new Date(so.deliveredAt.getTime() + windowDays * 86_400_000)) : null };
  }
  const rejected = refunds.find((r) => r.status === "rejected");
  return {
    orderNumber: so.order.orderNumber,
    sellerOrderId: so.id,
    shopName: so.business.name,
    status: isBooking && so.status === "processing" ? "Booked" : ORDER_STATUS_LABELS[so.status],
    payOnDelivery: so.payOnDelivery,
    isBooking,
    paid: formatPrice(so.payOnDelivery ? so.subtotalKobo - so.discountKobo + so.deliveryKobo : paidOnline(so)),
    left: formatPrice(left),
    items,
    refunds,
    dispute,
    canCancel: !so.payOnDelivery && !isBooking && so.status === "paid" && paidOnlineOrder,
    request,
    // After a decision there is nothing left to dispute; a withdrawn dispute can be opened again.
    canDispute: { allowed: !dispute || dispute.status === "closed", refundId: rejected && !dispute ? rejected.id : null },
  };
}

/** The customer's refunds across their orders (signed in, under RLS). */
export async function customerRefunds(tx: Tx, userId: string) {
  const rows = await tx.refund.findMany({
    where: { order: { userId } },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { items: { include: { orderItem: { select: { snapshot: true } } } }, order: { select: { orderNumber: true } }, business: { select: { name: true } } },
  });
  return rows.map((r) => ({ ...summariseRefund(r), orderNumber: r.order.orderNumber, shop: r.business?.name ?? "TownMart", sellerOrderId: r.sellerOrderId }));
}
