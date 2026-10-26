import { formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";

export type MessageView = { id: string; mine: boolean; author: string; body: string; at: string; read: boolean };

/**
 * The conversation on one seller order, oldest first, from one side's point
 * of view. Marks the other side's messages as read. `tx` is the viewer's own
 * scope (seller RLS, the customer's RLS, or the system scope for a guest
 * already checked by their order link).
 */
export async function loadConversation(tx: Tx, p: { sellerOrderId: string; viewer: "seller" | "customer"; sellerName: string; customerName: string }): Promise<MessageView[]> {
  const rows = await tx.message.findMany({ where: { sellerOrderId: p.sellerOrderId }, orderBy: { createdAt: "asc" }, take: 200 });
  const unread = rows.filter((m) => m.sender !== p.viewer && m.readAt === null).map((m) => m.id);
  if (unread.length) await tx.message.updateMany({ where: { id: { in: unread } }, data: { readAt: new Date() } });
  return rows.map((m) => ({
    id: m.id,
    mine: m.sender === p.viewer,
    author: m.sender === "seller" ? p.sellerName : m.sender === "customer" ? p.customerName : "TownMart",
    body: m.body,
    at: formatDateTime(m.createdAt),
    read: m.readAt !== null,
  }));
}

export type InboxRow = { sellerOrderId: string; orderNumber: string; customer: string; last: string; lastFrom: "customer" | "seller"; at: string; unread: number };

/**
 * A seller's conversations, most recent first: one row per order with its
 * latest message and how many customer messages are unread. Seller RLS.
 */
export async function sellerInbox(tx: Tx, businessId: string, take = 50): Promise<InboxRow[]> {
  const latest = await tx.$queryRaw<{ seller_order_id: string; last_at: Date }[]>`
    SELECT seller_order_id, max(created_at) AS last_at FROM messages
    WHERE business_id = ${businessId}::uuid GROUP BY seller_order_id ORDER BY last_at DESC LIMIT ${take}`;
  if (!latest.length) return [];
  const ids = latest.map((l) => l.seller_order_id);
  const [orders, lasts, unread] = await Promise.all([
    tx.sellerOrder.findMany({ where: { id: { in: ids }, businessId }, select: { id: true, orderNumber: true, fulfilmentContact: true } }),
    tx.message.findMany({ where: { sellerOrderId: { in: ids }, businessId }, orderBy: { createdAt: "desc" }, distinct: ["sellerOrderId"], select: { sellerOrderId: true, body: true, sender: true, createdAt: true } }),
    tx.message.groupBy({ by: ["sellerOrderId"], where: { sellerOrderId: { in: ids }, businessId, sender: "customer", readAt: null }, _count: true }),
  ]);
  return latest.flatMap((l) => {
    const so = orders.find((o) => o.id === l.seller_order_id);
    const m = lasts.find((x) => x.sellerOrderId === l.seller_order_id);
    if (!so || !m) return [];
    return [
      {
        sellerOrderId: so.id,
        orderNumber: so.orderNumber,
        customer: (so.fulfilmentContact as { name?: string } | null)?.name ?? "Customer",
        last: m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body,
        lastFrom: m.sender === "customer" ? ("customer" as const) : ("seller" as const),
        at: formatDateTime(m.createdAt),
        unread: unread.find((u) => u.sellerOrderId === so.id)?._count ?? 0,
      },
    ];
  });
}
