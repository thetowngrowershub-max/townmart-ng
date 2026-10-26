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
