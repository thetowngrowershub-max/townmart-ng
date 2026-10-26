import type { OrderStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";

/** Appends to order_status_history. Every status change goes through here. */
export async function recordStatus(
  tx: Tx,
  p: { sellerOrderId: string; businessId: string; from: OrderStatus | null; to: OrderStatus; actorUserId?: string | null; note?: string },
): Promise<void> {
  await tx.orderStatusHistory.create({
    data: { sellerOrderId: p.sellerOrderId, businessId: p.businessId, fromStatus: p.from, toStatus: p.to, actorUserId: p.actorUserId ?? null, note: p.note ?? null },
  });
}

/** Moves every seller order of an order from one status to another, with history. */
export async function moveSellerOrders(tx: Tx, orderId: string, from: OrderStatus[], to: OrderStatus, note: string, actorUserId: string | null = null): Promise<void> {
  const rows = await tx.sellerOrder.findMany({ where: { orderId, status: { in: from } }, select: { id: true, businessId: true, status: true } });
  for (const so of rows) {
    await tx.sellerOrder.update({ where: { id: so.id }, data: { status: to } });
    await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to, actorUserId, note });
  }
}
