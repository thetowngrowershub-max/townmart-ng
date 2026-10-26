import type { OrderStatus, SellerOrder } from "@prisma/client";
import { adjustStock } from "@/lib/catalogue/products";
import type { Tx } from "@/lib/db";
import { moveBooking } from "@/lib/bookings/status";
import { recordStatus } from "@/lib/orders/status";

/**
 * Seller order steps. Sellers move their own orders forward under RLS; the
 * database trigger guard_seller_order_status allows only these steps for
 * them, whatever the app sends. Cancelling and completing run in the system
 * scope.
 */
export class FulfilmentError extends Error {}

export type SellerStep = "processing" | "shipped" | "ready_for_pickup" | "delivered";

/** The next steps a seller can take from a status, given how the order is fulfilled. */
export function nextSteps(so: Pick<SellerOrder, "status" | "deliveryMethod">): SellerStep[] {
  if (so.deliveryMethod === "none") return [];
  switch (so.status) {
    case "paid":
      return ["processing"];
    case "processing":
      return [so.deliveryMethod === "pickup" ? "ready_for_pickup" : "shipped"];
    case "shipped":
    case "ready_for_pickup":
      return ["delivered"];
    default:
      return [];
  }
}

export const STEP_LABELS: Record<SellerStep, string> = {
  processing: "Start preparing",
  shipped: "Mark as sent",
  ready_for_pickup: "Ready for pickup",
  delivered: "Mark as delivered",
};

/**
 * Moves one seller order a step forward. `tx` is the seller's RLS
 * transaction: the row lock, the column grants and the status trigger all
 * apply to them.
 */
export async function advanceSellerOrder(
  tx: Tx,
  p: { sellerOrderId: string; businessId: string; to: SellerStep; actorUserId: string; tracking?: { number: string; carrier: string | null } | null; escrowReleaseDays: number; now?: Date },
): Promise<SellerOrder> {
  const now = p.now ?? new Date();
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM seller_orders WHERE id = ${p.sellerOrderId}::uuid AND business_id = ${p.businessId}::uuid FOR UPDATE`;
  if (!rows.length) throw new FulfilmentError("Order not found.");
  const so = await tx.sellerOrder.findUniqueOrThrow({ where: { id: p.sellerOrderId } });
  if (!nextSteps(so).includes(p.to)) throw new FulfilmentError("This order has already moved on. Refresh the page to see its status.");
  const updated = await tx.sellerOrder.update({
    where: { id: so.id },
    data: {
      status: p.to,
      ...(p.to === "shipped" ? { shippedAt: now, trackingNumber: p.tracking?.number ?? null, carrier: p.tracking?.carrier ?? null } : {}),
      ...(p.to === "delivered" ? { deliveredAt: now, escrowReleaseAt: new Date(now.getTime() + p.escrowReleaseDays * 86_400_000) } : {}),
    },
  });
  const note = p.to === "shipped" && p.tracking ? `Tracking ${p.tracking.carrier ? `${p.tracking.carrier} ` : ""}${p.tracking.number}` : undefined;
  await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to: p.to, actorUserId: p.actorUserId, note });
  return updated;
}

/** Pay on delivery: the seller confirms they've been paid. */
export async function markCashCollected(tx: Tx, p: { sellerOrderId: string; businessId: string; now?: Date }): Promise<void> {
  const so = await tx.sellerOrder.findFirst({ where: { id: p.sellerOrderId, businessId: p.businessId } });
  if (!so) throw new FulfilmentError("Order not found.");
  if (!so.payOnDelivery) throw new FulfilmentError("This order was paid online.");
  if (so.cashCollectedAt) return;
  if (!["shipped", "ready_for_pickup", "delivered", "completed"].includes(so.status) && so.deliveryMethod !== "none") {
    throw new FulfilmentError("Send or hand over the order first.");
  }
  await tx.sellerOrder.update({ where: { id: so.id }, data: { cashCollectedAt: p.now ?? new Date() } });
}

/** Statuses from which a seller can still cancel a pay-on-delivery order (nothing handed over yet). */
const CANCELLABLE: readonly OrderStatus[] = ["processing", "ready_for_pickup"];

/**
 * Cancels a seller's part of a pay-on-delivery order before handover:
 * stock goes back on sale and bookings are released. System scope. Paid
 * orders are cancelled with a refund (lib/refunds/cancel.ts).
 */
export async function cancelSellerOrder(tx: Tx, p: { sellerOrderId: string; businessId: string; actorUserId: string | null; reason: string; by: "seller" | "customer" }): Promise<void> {
  await tx.$queryRaw`SELECT id FROM seller_orders WHERE id = ${p.sellerOrderId}::uuid FOR UPDATE`;
  const so = await tx.sellerOrder.findFirst({ where: { id: p.sellerOrderId, businessId: p.businessId } });
  if (!so) throw new FulfilmentError("Order not found.");
  if (!so.payOnDelivery) throw new FulfilmentError("Paid orders are cancelled with a refund.");
  if (!CANCELLABLE.includes(so.status)) throw new FulfilmentError("This order can't be cancelled any more.");

  const reservations = await tx.stockReservation.findMany({ where: { sellerOrderId: so.id, status: { in: ["held", "converted"] } }, orderBy: { variantId: "asc" } });
  for (const r of reservations) {
    await adjustStock(tx, { businessId: r.businessId, variantId: r.variantId, change: r.qty, reason: "release", referenceType: "order", referenceId: so.orderId, actorUserId: p.actorUserId, note: `Cancelled ${so.orderNumber}` });
  }
  await tx.stockReservation.updateMany({ where: { id: { in: reservations.map((r) => r.id) } }, data: { status: "released" } });

  const bookings = await tx.booking.findMany({ where: { sellerOrderId: so.id, status: { in: ["held", "requested", "confirmed"] } } });
  for (const b of bookings) await moveBooking(tx, b, "cancelled", `Order cancelled by the ${p.by}`, p.actorUserId, { cancelReason: p.reason });

  await tx.sellerOrder.update({ where: { id: so.id }, data: { status: "cancelled" } });
  await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to: "cancelled", actorUserId: p.actorUserId, note: `Cancelled by the ${p.by}: ${p.reason}` });

  const open = await tx.sellerOrder.count({ where: { orderId: so.orderId, status: { not: "cancelled" } } });
  if (open === 0) await tx.order.update({ where: { id: so.orderId }, data: { cancelledAt: new Date(), cancelReason: p.reason } });
}

/** Delivered → completed: the customer confirmed, or the auto-complete job ran. System scope. */
export async function completeSellerOrder(tx: Tx, p: { sellerOrderId: string; actorUserId: string | null; note: string; now?: Date }): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM seller_orders WHERE id = ${p.sellerOrderId}::uuid FOR UPDATE`;
  const so = await tx.sellerOrder.findUnique({ where: { id: p.sellerOrderId } });
  if (!so || so.status !== "delivered") return false;
  await tx.sellerOrder.update({ where: { id: so.id }, data: { status: "completed", completedAt: p.now ?? new Date() } });
  await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to: "completed", actorUserId: p.actorUserId, note: p.note });
  return true;
}

/**
 * A booking-only seller order follows its bookings: once none is still to
 * happen, it's delivered (if any took place) or cancelled. System scope.
 */
export async function settleBookingOrder(tx: Tx, sellerOrderId: string, escrowReleaseDays: number, now = new Date()): Promise<void> {
  const so = await tx.sellerOrder.findUnique({ where: { id: sellerOrderId }, include: { bookings: { select: { status: true } } } });
  if (!so || so.deliveryMethod !== "none" || !["paid", "processing"].includes(so.status)) return;
  const live = so.bookings.filter((b) => ["held", "requested", "confirmed", "in_progress"].includes(b.status));
  if (live.length) return;
  const happened = so.bookings.some((b) => b.status === "completed");
  // Moved bookings point to a newer booking on the same seller order, so "rescheduled" alone never settles it.
  const to: OrderStatus = happened ? "completed" : "cancelled";
  // Either way escrow is released after the usual period: what's left after any
  // refund (a late cancellation's kept share, a no-show's deposit) is the provider's.
  const escrowReleaseAt = new Date(now.getTime() + escrowReleaseDays * 86_400_000);
  await tx.sellerOrder.update({
    where: { id: so.id },
    data: { status: to, escrowReleaseAt, ...(happened ? { deliveredAt: now, completedAt: now } : {}) },
  });
  await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to, note: happened ? "All bookings done" : "No booking took place" });
}

/** Completes delivered orders the customer hasn't confirmed within `days`. Worker job. */
export async function autoCompleteDelivered(tx: Tx, days: number, now = new Date()): Promise<number> {
  const due = await tx.sellerOrder.findMany({ where: { status: "delivered", deliveredAt: { lt: new Date(now.getTime() - days * 86_400_000) } }, select: { id: true }, take: 500 });
  let n = 0;
  for (const so of due) if (await completeSellerOrder(tx, { sellerOrderId: so.id, actorUserId: null, note: `Completed automatically ${days} days after delivery`, now })) n++;
  return n;
}
