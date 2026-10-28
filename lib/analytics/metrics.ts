import type { Tx } from "@/lib/db";

/**
 * Marketplace figures for the admin dashboard. All in Lagos time, money in
 * kobo (BigInt).
 *
 * Definitions (shown on the page too):
 *  - A *confirmed* order is one that was paid online, or accepted as pay on
 *    delivery. Unpaid, failed and expired checkouts don't count.
 *  - GMV is the total customers agreed to pay on confirmed orders (items,
 *    delivery, fees and VAT, after discounts), before refunds.
 *  - Refunds are refunds completed in the period, by the date they were paid.
 *  - Active sellers had at least one confirmed order in the period.
 *  - New customers are sign-ups in the period with no role beyond customer.
 */

export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const parseRange = (v: string | undefined): RangeDays => (RANGES.find((r) => String(r) === v) ?? 30);

const CONFIRMED = `o.payment_status IN ('paid', 'pay_on_delivery', 'refunded', 'partially_refunded')`;

/** Midnight Lagos time, `days` days before today's midnight (Lagos is UTC+1 all year). */
export function lagosDayStart(now: Date, daysBack: number): Date {
  const lagos = new Date(now.getTime() + 3600_000);
  const midnightUtc = Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 3600_000;
  return new Date(midnightUtc - daysBack * 86_400_000);
}

export type Period = { from: Date; to: Date };

/** The last `days` days including today, and the same length before it. */
export function periods(days: RangeDays, now = new Date()): { current: Period; previous: Period } {
  const from = lagosDayStart(now, days - 1);
  return { current: { from, to: now }, previous: { from: new Date(from.getTime() - days * 86_400_000), to: from } };
}

type Totals = { gmvKobo: bigint; orders: number; refundsKobo: bigint; refundedOrders: number; activeSellers: number; newCustomers: number; bookings: number };

async function totals(tx: Tx, p: Period): Promise<Totals> {
  const [o] = await tx.$queryRawUnsafe<{ gmv: bigint | null; n: bigint }[]>(
    `SELECT sum(o.total_kobo)::bigint AS gmv, count(*) AS n FROM orders o WHERE ${CONFIRMED} AND o.placed_at >= $1 AND o.placed_at < $2`,
    p.from,
    p.to,
  );
  const [r] = await tx.$queryRaw<{ amount: bigint | null; orders: bigint }[]>`
    SELECT sum(r.amount_kobo)::bigint AS amount, count(DISTINCT r.order_id) AS orders
      FROM refunds r WHERE r.status = 'completed' AND r.completed_at >= ${p.from} AND r.completed_at < ${p.to}`;
  const [s] = await tx.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(DISTINCT so.business_id) AS n FROM seller_orders so JOIN orders o ON o.id = so.order_id
      WHERE ${CONFIRMED} AND o.placed_at >= $1 AND o.placed_at < $2`,
    p.from,
    p.to,
  );
  const [c] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM users u
     WHERE u.created_at >= ${p.from} AND u.created_at < ${p.to} AND u.status <> 'anonymised'
       AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role <> 'customer')`;
  const [b] = await tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM bookings b
     WHERE b.created_at >= ${p.from} AND b.created_at < ${p.to} AND b.status NOT IN ('held', 'rescheduled')`;
  return {
    gmvKobo: o?.gmv ?? 0n,
    orders: Number(o?.n ?? 0),
    refundsKobo: r?.amount ?? 0n,
    refundedOrders: Number(r?.orders ?? 0),
    activeSellers: Number(s?.n ?? 0),
    newCustomers: Number(c?.n ?? 0),
    bookings: Number(b?.n ?? 0),
  };
}

/** Change from the previous period, as a whole percentage; null when there's nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** Refunds paid as a share of GMV, in basis points (1 = 0.01%). */
export const refundRateBps = (refundsKobo: bigint, gmvKobo: bigint): number => (gmvKobo === 0n ? 0 : Number((refundsKobo * 10_000n) / gmvKobo));

export type DayPoint = { day: string; gmvKobo: bigint; orders: number };

/** One point per Lagos day in the period, zero-filled. */
async function daily(tx: Tx, p: Period, days: number): Promise<DayPoint[]> {
  const rows = await tx.$queryRawUnsafe<{ day: string; gmv: bigint; n: bigint }[]>(
    `SELECT to_char(o.placed_at AT TIME ZONE 'Africa/Lagos', 'YYYY-MM-DD') AS day, sum(o.total_kobo)::bigint AS gmv, count(*) AS n
       FROM orders o WHERE ${CONFIRMED} AND o.placed_at >= $1 AND o.placed_at < $2 GROUP BY 1`,
    p.from,
    p.to,
  );
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(p.from.getTime() + i * 86_400_000 + 3600_000).toISOString().slice(0, 10);
    const r = byDay.get(day);
    return { day, gmvKobo: r?.gmv ?? 0n, orders: Number(r?.n ?? 0) };
  });
}

export type Ranked = { id: string; name: string; gmvKobo: bigint; orders: number };

/** Top-level categories by the value of confirmed items sold (after item discounts). */
async function topCategories(tx: Tx, p: Period, limit = 6): Promise<Ranked[]> {
  const rows = await tx.$queryRawUnsafe<{ id: string; name: string; gmv: bigint; n: bigint }[]>(
    `WITH lines AS (
       SELECT COALESCE(pr.category_id, sv.category_id) AS category_id, i.line_total_kobo, o.id AS order_id
         FROM order_items i
         JOIN seller_orders so ON so.id = i.seller_order_id
         JOIN orders o ON o.id = so.order_id
         LEFT JOIN products pr ON pr.id = i.product_id
         LEFT JOIN services sv ON sv.id = i.service_id
        WHERE ${CONFIRMED} AND o.placed_at >= $1 AND o.placed_at < $2)
     SELECT top.id::text AS id, top.name, sum(l.line_total_kobo)::bigint AS gmv, count(DISTINCT l.order_id) AS n
       FROM lines l
       JOIN categories c ON c.id = l.category_id
       JOIN categories top ON top.id = COALESCE(c.parent_id, c.id)
      GROUP BY top.id, top.name ORDER BY gmv DESC LIMIT $3`,
    p.from,
    p.to,
    limit,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, gmvKobo: r.gmv, orders: Number(r.n) }));
}

/** Sellers by the value of their confirmed seller orders. */
async function topSellers(tx: Tx, p: Period, limit = 6): Promise<Ranked[]> {
  const rows = await tx.$queryRawUnsafe<{ id: string; name: string; gmv: bigint; n: bigint }[]>(
    `SELECT b.id::text AS id, b.name, sum(so.subtotal_kobo - so.discount_kobo + so.delivery_kobo)::bigint AS gmv, count(*) AS n
       FROM seller_orders so JOIN orders o ON o.id = so.order_id JOIN businesses b ON b.id = so.business_id
      WHERE ${CONFIRMED} AND o.placed_at >= $1 AND o.placed_at < $2
      GROUP BY b.id, b.name ORDER BY gmv DESC LIMIT $3`,
    p.from,
    p.to,
    limit,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, gmvKobo: r.gmv, orders: Number(r.n) }));
}

/** Where confirmed orders were delivered (or the customer's state for collection), by order count. */
async function topStates(tx: Tx, p: Period, limit = 6): Promise<{ name: string; orders: number }[]> {
  const rows = await tx.$queryRawUnsafe<{ name: string; n: bigint }[]>(
    `SELECT COALESCE(o.shipping_address_snapshot->>'stateName', 'Not given') AS name, count(*) AS n
       FROM orders o WHERE ${CONFIRMED} AND o.placed_at >= $1 AND o.placed_at < $2
      GROUP BY 1 ORDER BY n DESC LIMIT $3`,
    p.from,
    p.to,
    limit,
  );
  return rows.map((r) => ({ name: r.name, orders: Number(r.n) }));
}

export async function dashboard(tx: Tx, days: RangeDays, now = new Date()) {
  const { current, previous } = periods(days, now);
  const [cur, prev, series, categories, sellers, states, approvedSellers] = await Promise.all([
    totals(tx, current),
    totals(tx, previous),
    daily(tx, current, days),
    topCategories(tx, current),
    topSellers(tx, current),
    topStates(tx, current),
    tx.business.count({ where: { status: "approved" } }),
  ]);
  const aov = (t: Totals) => (t.orders ? t.gmvKobo / BigInt(t.orders) : 0n);
  return {
    period: current,
    totals: { ...cur, aovKobo: aov(cur), refundRateBps: refundRateBps(cur.refundsKobo, cur.gmvKobo), approvedSellers },
    changes: {
      gmv: change(Number(cur.gmvKobo), Number(prev.gmvKobo)),
      orders: change(cur.orders, prev.orders),
      aov: change(Number(aov(cur)), Number(aov(prev))),
      activeSellers: change(cur.activeSellers, prev.activeSellers),
      newCustomers: change(cur.newCustomers, prev.newCustomers),
      bookings: change(cur.bookings, prev.bookings),
      refundRate: cur.gmvKobo && prev.gmvKobo ? refundRateBps(cur.refundsKobo, cur.gmvKobo) - refundRateBps(prev.refundsKobo, prev.gmvKobo) : null,
    },
    series,
    categories,
    sellers,
    states,
  };
}

export type Dashboard = Awaited<ReturnType<typeof dashboard>>;
