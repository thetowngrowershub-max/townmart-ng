import type { Rider, SellerOrder } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { FulfilmentError } from "@/lib/fulfilment/orders";
import { assignRider, RIDER_STATUSES } from "@/lib/fulfilment/riders";
import { haversineMetres, type LatLng } from "@/lib/geo/distance";
import { creditRiderEarning } from "@/lib/wallets/rider";

/**
 * The TownMart rider pool. Pool riders belong to no shop (riders.business_id
 * is null): they apply from the /rider area with their TownMart sign-in,
 * TownMart vets them in Admin > Riders, and once approved they switch
 * themselves online and take any shop's deliveries.
 *
 * A delivery is "open to the pool" when riderPoolOpenedAt is set and it has
 * no rider. Shops on TownMart riders (the standard) open every paid delivery
 * automatically; shops on their own riders can open one by hand. The nearest
 * online riders get a text, and the first to tap "Take this job" gets it.
 * The rider's pay (their share of the delivery fee) is fixed when they take it
 * and credited to their wallet when the order is delivered.
 */

export const POOL_RIDER_STATUSES = ["pending", "approved", "suspended", "rejected"] as const;
export type PoolRiderStatus = (typeof POOL_RIDER_STATUSES)[number];
export const POOL_STATUS_LABELS: Record<PoolRiderStatus, string> = {
  pending: "Waiting for approval",
  approved: "Approved",
  suspended: "Suspended",
  rejected: "Not approved",
};

/** Statuses where a pool rider can still take a delivery (before it's on its way). */
export const OPEN_JOB_STATUSES = ["paid", "processing"] as const;

/** A last position older than this doesn't count for "nearest". */
export const LOCATION_FRESH_MS = 2 * 3600_000;

/** The rider's share of a delivery fee, rounded down to the kobo. */
export function riderPay(deliveryKobo: bigint, sharePercent: number): bigint {
  if (deliveryKobo <= 0n) return 0n;
  const bps = BigInt(Math.round(Math.min(100, Math.max(0, sharePercent)) * 100));
  return (deliveryKobo * bps) / 10_000n;
}

export const isPoolRider = (r: Pick<Rider, "businessId"> | null | undefined): boolean => Boolean(r) && r!.businessId === null;

/** The signed-in user's pool rider record, whatever its status, or null. Own RLS scope or system. */
export function poolRiderForUser(tx: Tx, userId: string): Promise<Rider | null> {
  return tx.rider.findFirst({ where: { userId, businessId: null } });
}

/** The signed-in user's approved, active pool rider, or null. For the rider area and the rider wallet. */
export function getPoolRider(tx: Tx, userId: string): Promise<Rider | null> {
  return tx.rider.findFirst({ where: { userId, businessId: null, status: "approved", isActive: true } });
}

function freshPoint(r: Pick<Rider, "latitude" | "longitude" | "locationUpdatedAt">, now: Date): LatLng | null {
  if (r.latitude === null || r.longitude === null || !r.locationUpdatedAt) return null;
  return now.getTime() - r.locationUpdatedAt.getTime() <= LOCATION_FRESH_MS ? { lat: r.latitude, lng: r.longitude } : null;
}

/**
 * Online pool riders who can take one more job, nearest the shop first. A
 * rider with no recent position comes after those with one. Pure.
 */
export function rankPoolRiders<R extends Pick<Rider, "id" | "latitude" | "longitude" | "locationUpdatedAt"> & { activeJobs: number }>(
  riders: readonly R[],
  shop: LatLng | null,
  maxJobs: number,
  now = new Date(),
): (R & { metresToShop: number | null })[] {
  return riders
    .filter((r) => r.activeJobs < maxJobs)
    .map((r) => {
      const p = freshPoint(r, now);
      return { ...r, metresToShop: shop && p ? Math.round(haversineMetres(shop, p)) : null };
    })
    .sort((a, b) => (a.metresToShop ?? Number.MAX_SAFE_INTEGER) - (b.metresToShop ?? Number.MAX_SAFE_INTEGER) || a.activeJobs - b.activeJobs);
}

/** How many deliveries each rider has in hand (assigned, not yet delivered). */
async function activeJobCounts(tx: Tx, riderIds: string[]): Promise<Map<string, number>> {
  if (riderIds.length === 0) return new Map();
  const rows = await tx.sellerOrder.groupBy({ by: ["riderId"], where: { riderId: { in: riderIds }, status: { in: [...RIDER_STATUSES] } }, _count: true });
  return new Map(rows.map((r) => [r.riderId!, r._count]));
}

/** Online approved pool riders for a pickup at `shop`, nearest first. System or admin scope. */
export async function poolCandidates(tx: Tx, shop: LatLng | null, maxJobs: number, now = new Date()) {
  const riders = await tx.rider.findMany({ where: { businessId: null, status: "approved", isActive: true, isAvailable: true } });
  const jobs = await activeJobCounts(tx, riders.map((r) => r.id));
  return rankPoolRiders(
    riders.map((r) => ({ ...r, activeJobs: jobs.get(r.id) ?? 0 })),
    shop,
    maxJobs,
    now,
  );
}

/**
 * Offers a delivery to the pool. True when it was opened just now (and the
 * caller should text nearby riders); false when it was already open, has a
 * rider, or is past needing one. Seller RLS or system scope.
 */
export async function openToPool(tx: Tx, sellerOrderId: string, now = new Date()): Promise<boolean> {
  const { count } = await tx.sellerOrder.updateMany({
    where: { id: sellerOrderId, deliveryMethod: "delivery", riderId: null, riderPoolOpenedAt: null, status: { in: [...OPEN_JOB_STATUSES] } },
    data: { riderPoolOpenedAt: now },
  });
  return count > 0;
}

/**
 * After an order is confirmed (paid, or placed with pay on delivery): every
 * delivery from a shop on TownMart riders goes to the pool. Returns the seller
 * orders opened, to text nearby riders about. System scope; safe to repeat.
 */
export async function openPoolJobsForOrder(tx: Tx, orderId: string, now = new Date()): Promise<{ sellerOrderId: string; openedAt: Date }[]> {
  const sos = await tx.sellerOrder.findMany({
    where: { orderId, deliveryMethod: "delivery", riderId: null, riderPoolOpenedAt: null, status: { in: [...OPEN_JOB_STATUSES] }, business: { riderMode: "townmart" } },
    select: { id: true },
  });
  const opened: { sellerOrderId: string; openedAt: Date }[] = [];
  for (const so of sos) if (await openToPool(tx, so.id, now)) opened.push({ sellerOrderId: so.id, openedAt: now });
  return opened;
}

export type OpenJob = {
  sellerOrderId: string;
  orderNumber: string;
  shop: string;
  shopArea: string;
  /** Town or landmark only: the full address and phone come with the job link once taken. */
  dropOff: string;
  deliveryMetres: number | null;
  /** From the rider's last position to the shop, when both are known. */
  metresToShop: number | null;
  payKobo: bigint;
  payOnDelivery: boolean;
  itemCount: number;
  openedAt: Date;
};

/** Deliveries open to the pool, nearest the rider first. System scope, after checking the rider. */
export async function openJobs(tx: Tx, rider: Pick<Rider, "latitude" | "longitude" | "locationUpdatedAt">, sharePercent: number, now = new Date()): Promise<OpenJob[]> {
  const list = await tx.sellerOrder.findMany({
    where: { deliveryMethod: "delivery", riderId: null, riderPoolOpenedAt: { not: null }, status: { in: [...OPEN_JOB_STATUSES] } },
    orderBy: { riderPoolOpenedAt: "asc" },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      deliveryKobo: true,
      deliveryDistanceM: true,
      payOnDelivery: true,
      fulfilmentContact: true,
      riderPoolOpenedAt: true,
      business: { select: { name: true, city: true, latitude: true, longitude: true } },
      _count: { select: { items: true } },
    },
  });
  const me = freshPoint(rider, now);
  return list
    .map((so): OpenJob => {
      const b = so.business;
      const a = (so.fulfilmentContact as { address?: { landmark: string | null; city: string } | null } | null)?.address;
      return {
        sellerOrderId: so.id,
        orderNumber: so.orderNumber,
        shop: b.name,
        shopArea: b.city,
        dropOff: a ? (a.landmark ? `Near ${a.landmark}, ${a.city}` : a.city) : "Customer",
        deliveryMetres: so.deliveryDistanceM,
        metresToShop: me && b.latitude !== null && b.longitude !== null ? Math.round(haversineMetres(me, { lat: b.latitude, lng: b.longitude })) : null,
        payKobo: riderPay(so.deliveryKobo, sharePercent),
        payOnDelivery: so.payOnDelivery,
        itemCount: so._count.items,
        openedAt: so.riderPoolOpenedAt!,
      };
    })
    .sort((x, y) => (x.metresToShop ?? Number.MAX_SAFE_INTEGER) - (y.metresToShop ?? Number.MAX_SAFE_INTEGER) || x.openedAt.getTime() - y.openedAt.getTime());
}

/** A pool rider's deliveries in hand (assigned, not delivered), oldest first. System scope. */
export function riderActiveJobs(tx: Tx, riderId: string) {
  return tx.sellerOrder.findMany({
    where: { riderId, status: { in: [...RIDER_STATUSES] } },
    orderBy: { riderAssignedAt: "asc" },
    select: { id: true, orderNumber: true, status: true, riderId: true, riderAssignedAt: true, pickedUpAt: true, riderPayKobo: true, payOnDelivery: true, business: { select: { name: true, city: true } } },
  });
}

async function lockSellerOrder(tx: Tx, id: string): Promise<SellerOrder | null> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM seller_orders WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length ? tx.sellerOrder.findUnique({ where: { id } }) : null;
}

export class PoolJobError extends FulfilmentError {}

/**
 * A pool rider takes an open delivery: first come, first served (the order
 * row is locked). Returns the assignment time for the "rider.assigned" notice
 * (job link to the rider, delivery code to the customer). System scope, after
 * the caller has checked the signed-in user is this rider.
 */
export async function acceptPoolJob(tx: Tx, p: { riderId: string; sellerOrderId: string; sharePercent: number; maxJobs: number }): Promise<Date> {
  const rider = await tx.rider.findFirst({ where: { id: p.riderId, businessId: null } });
  if (!rider || rider.status !== "approved" || !rider.isActive) throw new PoolJobError("Your rider account isn't approved for jobs right now.");
  if (!rider.isAvailable) throw new PoolJobError("Go online first to take jobs.");
  const so = await lockSellerOrder(tx, p.sellerOrderId);
  if (!so || so.deliveryMethod !== "delivery" || !so.riderPoolOpenedAt || !(OPEN_JOB_STATUSES as readonly string[]).includes(so.status)) {
    throw new PoolJobError("This job is no longer available.");
  }
  if (so.riderId) throw new PoolJobError(so.riderId === rider.id ? "This job is already yours." : "Another rider took this job first.");
  const held = (await activeJobCounts(tx, [rider.id])).get(rider.id) ?? 0;
  if (held >= p.maxJobs) throw new PoolJobError(`You already have ${held} deliver${held === 1 ? "y" : "ies"} in hand. Deliver one first.`);
  const r = await assignRider(tx, { sellerOrderId: so.id, businessId: so.businessId, riderId: rider.id, actorUserId: rider.userId, pool: { payKobo: riderPay(so.deliveryKobo, p.sharePercent) } });
  return r.assignedAt!;
}

/**
 * A pool rider can't do a job after all (before pickup): it goes back to the
 * pool for someone else. True when it did. System scope, after the caller has
 * checked the signed-in user is this rider.
 */
export async function dropPoolJob(tx: Tx, p: { riderId: string; userId: string; sellerOrderId: string }): Promise<boolean> {
  const so = await lockSellerOrder(tx, p.sellerOrderId);
  if (!so || so.riderId !== p.riderId) throw new PoolJobError("This job isn't yours.");
  if (so.pickedUpAt || so.status === "shipped") throw new PoolJobError("You've already picked this up. Call the shop or TownMart if you can't finish it.");
  await assignRider(tx, { sellerOrderId: so.id, businessId: so.businessId, riderId: null, actorUserId: p.userId });
  // Back in the pool, even for a shop on its own riders that asked for one.
  await tx.sellerOrder.update({ where: { id: so.id }, data: { riderPoolOpenedAt: new Date() } });
  return true;
}

/**
 * The order was delivered: a pool rider gets their pay in their wallet.
 * System scope; safe to repeat (the wallet credits once per seller order).
 */
export async function payPoolRiderOnDelivery(tx: Tx, sellerOrderId: string): Promise<boolean> {
  const so = await tx.sellerOrder.findUnique({
    where: { id: sellerOrderId },
    select: { id: true, orderNumber: true, status: true, riderId: true, riderPayKobo: true, rider: { select: { businessId: true } } },
  });
  if (!so?.riderId || !so.rider || so.rider.businessId !== null || so.riderPayKobo === null) return false;
  if (so.status !== "delivered" && so.status !== "completed") return false;
  await creditRiderEarning(tx, { riderId: so.riderId, sellerOrderId: so.id, amountKobo: so.riderPayKobo, memo: `Delivery ${so.orderNumber}` });
  return true;
}
