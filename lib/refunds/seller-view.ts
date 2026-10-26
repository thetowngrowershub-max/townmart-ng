import type { RefundStatus } from "@prisma/client";
import { formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { OUTCOME_LABELS } from "@/lib/disputes/core";
import { formatPrice } from "@/lib/money";
import type { FulfilmentContact } from "@/lib/orders/place";
import { refundedSoFar } from "./core";
import { paidOnline, REASON_LABELS, STATUS_LABELS } from "./math";
import { loadDispute, summariseRefund, type DisputeView, type RefundSummary } from "./view";

/**
 * The seller's refunds and disputes pages. Seller RLS transactions, filtered
 * to the business too. Sellers can't read `orders`, so the order number and
 * customer name come from the seller order.
 */

const soSelect = { select: { orderNumber: true, fulfilmentContact: true } } as const;
const customerOf = (so: { fulfilmentContact: unknown }) => (so.fulfilmentContact as FulfilmentContact | null)?.name ?? "Customer";

export const REFUND_FILTERS = { waiting: "Waiting for you", disputes: "Disputes", all: "All refunds" } as const;
export type RefundFilter = keyof typeof REFUND_FILTERS;

export type SellerRefundRow = { id: string; number: string; orderNumber: string; sellerOrderId: string | null; customer: string; reason: string; amount: string; status: RefundStatus; statusLabel: string; createdAt: string; respondBy: string | null };
export type SellerDisputeRow = { id: string; orderNumber: string; sellerOrderId: string; customer: string; reason: string; status: string; outcome: string | null; openedAt: string; lastMessageAt: string };

export async function listSellerRefunds(tx: Tx, businessId: string, filter: RefundFilter) {
  const counts = {
    waiting: await tx.refund.count({ where: { businessId, status: "requested" } }),
    disputes: await tx.dispute.count({ where: { businessId, status: "open" } }),
    all: await tx.refund.count({ where: { businessId } }),
  };
  if (filter === "disputes") {
    const rows = await tx.dispute.findMany({
      where: { businessId },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 100,
      include: { sellerOrder: soSelect, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } },
    });
    const disputes: SellerDisputeRow[] = rows.map((d) => ({
      id: d.id,
      orderNumber: d.sellerOrder.orderNumber,
      sellerOrderId: d.sellerOrderId,
      customer: customerOf(d.sellerOrder),
      reason: d.reason,
      status: d.status === "open" ? "Open" : d.status === "resolved" ? "Decided" : "Withdrawn",
      outcome: d.outcome ? OUTCOME_LABELS[d.outcome] : null,
      openedAt: formatDateTime(d.createdAt),
      lastMessageAt: formatDateTime(d.messages[0]?.createdAt ?? d.createdAt),
    }));
    return { counts, refunds: [] as SellerRefundRow[], disputes };
  }
  const rows = await tx.refund.findMany({
    where: { businessId, ...(filter === "waiting" ? { status: "requested" as const } : {}) },
    orderBy: filter === "waiting" ? { respondBy: "asc" } : { createdAt: "desc" },
    take: 100,
    include: { sellerOrder: soSelect },
  });
  const refunds: SellerRefundRow[] = rows.map((r) => ({
    id: r.id,
    number: r.refundNumber,
    orderNumber: r.sellerOrder?.orderNumber ?? "",
    sellerOrderId: r.sellerOrderId,
    customer: r.sellerOrder ? customerOf(r.sellerOrder) : "Customer",
    reason: REASON_LABELS[r.reason],
    amount: formatPrice(r.status === "requested" || r.status === "rejected" ? r.requestedKobo : r.amountKobo),
    status: r.status,
    statusLabel: STATUS_LABELS[r.status],
    createdAt: formatDateTime(r.createdAt),
    respondBy: r.status === "requested" && r.respondBy ? formatDateTime(r.respondBy) : null,
  }));
  return { counts, refunds, disputes: [] as SellerDisputeRow[] };
}

export type SellerRefundDetail = {
  refund: RefundSummary;
  orderNumber: string;
  sellerOrderId: string;
  customer: string;
  paid: string;
  left: string;
  /** Kobo as a string, the most this refund can be approved for. */
  maxKobo: string;
  items: { orderItemId: string; title: string; qty: string; product: boolean }[];
  dispute: DisputeView | null;
};

export async function loadSellerRefund(tx: Tx, businessId: string, refundId: string): Promise<SellerRefundDetail | null> {
  const r = await tx.refund.findFirst({
    where: { id: refundId, businessId },
    include: { items: { include: { orderItem: { select: { snapshot: true, productId: true } } } }, sellerOrder: true },
  });
  if (!r || !r.sellerOrder) return null;
  const so = r.sellerOrder;
  const before = await refundedSoFar(tx, so.id);
  const left = paidOnline(so) - before.amountKobo;
  return {
    refund: summariseRefund(r),
    orderNumber: so.orderNumber,
    sellerOrderId: so.id,
    customer: customerOf(so),
    paid: formatPrice(paidOnline(so)),
    left: formatPrice(left),
    maxKobo: (r.requestedKobo < left ? r.requestedKobo : left).toString(),
    items: r.items.map((i) => ({ orderItemId: i.orderItemId, title: (i.orderItem.snapshot as { title: string }).title, qty: i.qty.toString(), product: !!i.orderItem.productId })),
    dispute: await loadDispute(tx, { sellerOrderId: so.id }),
  };
}

/** Refunds on one seller order, for the seller's order page. */
export async function sellerOrderRefunds(tx: Tx, businessId: string, sellerOrderId: string) {
  const rows = await tx.refund.findMany({ where: { businessId, sellerOrderId }, orderBy: { createdAt: "desc" }, include: { items: { include: { orderItem: { select: { snapshot: true } } } } } });
  const dispute = await tx.dispute.findFirst({ where: { businessId, sellerOrderId }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } });
  return { refunds: rows.map(summariseRefund), dispute };
}
