import type { OrderStatus } from "@prisma/client";
import { dateToLagosLocal } from "@/lib/datetime";
import type { Tx } from "@/lib/db";

/** Orders that count as sales: placed (paid, or pay on delivery) and not cancelled or refunded. */
export const SALE_STATUSES: OrderStatus[] = ["paid", "processing", "ready_for_pickup", "shipped", "delivered", "completed"];

const lagosMidnight = (d: Date) => new Date(`${dateToLagosLocal(d).slice(0, 10)}T00:00:00+01:00`);

export type SellerKpis = {
  todayKobo: bigint;
  todayOrders: number;
  pendingOrders: number;
  upcomingBookings: number;
  escrowKobo: bigint;
  availableKobo: bigint;
  /** The last 14 Lagos days, oldest first. */
  daily: { date: string; kobo: bigint; orders: number }[];
  topProducts: { productId: string; title: string; qty: string; kobo: bigint }[];
};

/** Figures for the seller dashboard. Seller RLS: every query sees only this business. */
export async function sellerKpis(tx: Tx, businessId: string, now = new Date()): Promise<SellerKpis> {
  const today = lagosMidnight(now);
  const since = new Date(today.getTime() - 13 * 86_400_000);
  const [daily, pendingOrders, upcomingBookings, balances, top] = await Promise.all([
    tx.$queryRaw<{ day: string; kobo: bigint; orders: bigint }[]>`
      SELECT to_char(created_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS day, sum(seller_net_kobo)::bigint AS kobo, count(*)::bigint AS orders
        FROM seller_orders
       WHERE business_id = ${businessId}::uuid AND created_at >= ${since} AND status::text = ANY(${SALE_STATUSES as string[]})
       GROUP BY 1`,
    tx.sellerOrder.count({ where: { businessId, status: { in: ["paid", "processing", "ready_for_pickup"] } } }),
    tx.booking.count({ where: { businessId, status: { in: ["requested", "confirmed"] }, startsAt: { gt: now, lt: new Date(now.getTime() + 7 * 86_400_000) } } }),
    tx.$queryRaw<{ type: string; balance: bigint }[]>`
      SELECT a.type::text AS type, coalesce(sum(e.credit_kobo - e.debit_kobo), 0)::bigint AS balance
        FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
       WHERE e.business_id = ${businessId}::uuid AND a.owner_type = 'business'
       GROUP BY 1`,
    tx.$queryRaw<{ product_id: string; title: string; qty: string; kobo: bigint }[]>`
      SELECT i.product_id, max(i.snapshot->>'title') AS title, sum(i.qty)::text AS qty, sum(i.line_total_kobo)::bigint AS kobo
        FROM order_items i JOIN seller_orders so ON so.id = i.seller_order_id
       WHERE i.business_id = ${businessId}::uuid AND i.product_id IS NOT NULL
         AND so.created_at >= ${new Date(now.getTime() - 30 * 86_400_000)} AND so.status::text = ANY(${SALE_STATUSES as string[]})
       GROUP BY i.product_id ORDER BY kobo DESC LIMIT 5`,
  ]);
  const days = Array.from({ length: 14 }, (_, i) => dateToLagosLocal(new Date(since.getTime() + i * 86_400_000 + 3_600_000)).slice(0, 10));
  const series = days.map((date) => {
    const d = daily.find((r) => r.day === date);
    return { date, kobo: d?.kobo ?? 0n, orders: Number(d?.orders ?? 0) };
  });
  const last = series.at(-1)!;
  return {
    todayKobo: last.kobo,
    todayOrders: last.orders,
    pendingOrders,
    upcomingBookings,
    escrowKobo: balances.find((b) => b.type === "escrow")?.balance ?? 0n,
    availableKobo: balances.find((b) => b.type === "available")?.balance ?? 0n,
    daily: series,
    topProducts: top.map((t) => ({ productId: t.product_id, title: t.title, qty: t.qty, kobo: t.kobo })),
  };
}
