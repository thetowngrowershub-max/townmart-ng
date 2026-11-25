import type { Booking, Refund } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { refundedSoFar, refundNow } from "./core";
import { bookingRefundPercent, itemPaidOnline, percentOf, RefundError } from "./math";

/**
 * Cancelling a paid seller order before it's handed over: everything is
 * refunded (delivery included), stock goes back on sale and bookings are
 * released. The seller can cancel until the order is sent or collected; the
 * customer only before the seller starts preparing it. System scope.
 */
export async function cancelPaidSellerOrder(
  tx: Tx,
  p: { sellerOrderId: string; businessId?: string; orderId?: string; by: "seller" | "customer"; actorUserId: string | null; reason: string },
): Promise<Refund> {
  await tx.$queryRaw`SELECT id FROM seller_orders WHERE id = ${p.sellerOrderId}::uuid FOR UPDATE`;
  const so = await tx.sellerOrder.findUnique({ where: { id: p.sellerOrderId } });
  if (!so || (p.businessId && so.businessId !== p.businessId) || (p.orderId && so.orderId !== p.orderId)) throw new RefundError("Order not found.");
  if (so.payOnDelivery) throw new RefundError("This order is paid on delivery: cancel it without a refund.");
  if (so.deliveryMethod === "none") throw new RefundError("Cancel the bookings in this order one by one.");
  const allowed = p.by === "seller" ? ["paid", "processing", "ready_for_pickup"] : ["paid"];
  if (!allowed.includes(so.status)) {
    throw new RefundError(p.by === "customer" ? "The seller has started on this order, so it can't be cancelled here. Ask for a refund instead." : "This order can't be cancelled any more.");
  }
  return refundNow(tx, {
    sellerOrderId: so.id,
    origin: p.by,
    requestedBy: p.actorUserId,
    reason: p.by === "seller" ? "cancelled_by_seller" : "cancelled_by_customer",
    details: p.reason,
    includeDelivery: true,
    restockItemIds: "all",
  });
}

/**
 * The refund owed when a paid booking is cancelled, under the Refund Policy:
 * in full if the provider cancels or the customer cancels 24 hours or more
 * ahead, `lateCancelPercent` if the customer cancels later. Only what was
 * paid online counts; a balance due on the day was never paid. Returns null
 * when nothing is owed (pay on delivery, nothing paid, already refunded).
 */
export async function refundCancelledBooking(
  tx: Tx,
  p: { booking: Booking; by: "seller" | "customer"; hoursBefore: number; actorUserId: string | null; lateCancelPercent: number },
): Promise<Refund | null> {
  const so = await tx.sellerOrder.findUniqueOrThrow({ where: { id: p.booking.sellerOrderId }, include: { order: { select: { paymentStatus: true } } } });
  if (so.payOnDelivery || (so.order.paymentStatus !== "paid" && so.order.paymentStatus !== "partially_refunded")) return null;
  const item = await tx.orderItem.findUniqueOrThrow({ where: { id: p.booking.orderItemId } });
  const done = (await refundedSoFar(tx, so.id)).items.get(item.id);
  if (done && done.qty >= Number(item.qty)) return null;
  const pct = bookingRefundPercent({ by: p.by, hoursBefore: p.hoursBefore, lateCancelPercent: p.lateCancelPercent });
  const amount = percentOf(itemPaidOnline(item, p.booking.balanceKobo), pct) - (done?.kobo ?? 0n);
  if (amount <= 0n) return null;
  return refundNow(tx, {
    sellerOrderId: so.id,
    origin: p.by,
    requestedBy: p.actorUserId,
    reason: "booking_cancelled",
    details: pct === 100 ? null : `Cancelled ${p.hoursBefore} hours before the start: ${pct}% refunded under the Refund Policy`,
    items: [{ orderItemId: item.id, qty: Number(item.qty) - (done?.qty ?? 0) }],
    includeDelivery: false,
    amountKobo: amount,
  });
}
