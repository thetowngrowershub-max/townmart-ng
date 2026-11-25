import type { Tx } from "@/lib/db";
import { haversineMetres, type LatLng } from "@/lib/geo/distance";
import { recordStatus } from "@/lib/orders/status";
import { FulfilmentError } from "./orders";

/**
 * Riders are a shop's own, or TownMart pool riders (lib/riders/pool.ts). This
 * file is the one place a rider is put on an order or taken off it, so
 * anything that should happen then (texts to the rider and customer) hooks in
 * here, not in the UI.
 */

export { RIDER_VEHICLES, VEHICLE_LABELS, type RiderVehicle } from "./rider-vehicles";

/** Statuses where a delivery still needs a rider (or is on its way). */
export const RIDER_STATUSES = ["paid", "processing", "shipped"] as const;

export type RiderCandidate = {
  id: string;
  name: string;
  vehicle: string;
  isAvailable: boolean;
  /** Deliveries assigned and not yet delivered. */
  activeJobs: number;
  /** From the rider's last known spot to the shop, or null when unknown (assumed at the shop). */
  metresToShop: number | null;
  locationUpdatedAt: Date | null;
  /** Within the "nearby" distance, free, and not on another delivery. */
  suggested: boolean;
};

/**
 * Ranks a shop's active riders for a pickup at the shop: available riders
 * with no delivery in hand first, nearest first. A rider with no location yet
 * is taken to be at the shop. Pure so it's easy to test.
 */
export function rankRiders(
  riders: readonly { id: string; name: string; vehicle: string; isAvailable: boolean; latitude: number | null; longitude: number | null; locationUpdatedAt: Date | null; activeJobs: number }[],
  shop: LatLng | null,
  nearbyKm: number,
): RiderCandidate[] {
  return riders
    .map((r) => {
      const metresToShop = shop && r.latitude !== null && r.longitude !== null ? Math.round(haversineMetres(shop, { lat: r.latitude, lng: r.longitude })) : null;
      const near = metresToShop === null || metresToShop <= nearbyKm * 1000;
      return {
        id: r.id,
        name: r.name,
        vehicle: r.vehicle,
        isAvailable: r.isAvailable,
        activeJobs: r.activeJobs,
        metresToShop,
        locationUpdatedAt: r.locationUpdatedAt,
        suggested: r.isAvailable && r.activeJobs === 0 && near,
      };
    })
    .sort(
      (a, b) =>
        Number(b.suggested) - Number(a.suggested) ||
        Number(b.isAvailable) - Number(a.isAvailable) ||
        a.activeJobs - b.activeJobs ||
        (a.metresToShop ?? 0) - (b.metresToShop ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** The shop's riders ranked for one of its orders. Seller RLS or system scope. */
export async function riderCandidates(tx: Tx, businessId: string, nearbyKm: number): Promise<RiderCandidate[]> {
  const [business, riders, jobs] = await Promise.all([
    tx.business.findUnique({ where: { id: businessId }, select: { latitude: true, longitude: true } }),
    tx.rider.findMany({ where: { businessId, isActive: true } }),
    tx.sellerOrder.groupBy({ by: ["riderId"], where: { businessId, riderId: { not: null }, status: { in: [...RIDER_STATUSES] } }, _count: true }),
  ]);
  const active = new Map(jobs.map((j) => [j.riderId!, j._count]));
  const shop = business?.latitude != null && business.longitude != null ? { lat: business.latitude, lng: business.longitude } : null;
  return rankRiders(
    riders.map((r) => ({ ...r, activeJobs: active.get(r.id) ?? 0 })),
    shop,
    nearbyKm,
  );
}

/**
 * Puts a rider on a delivery (or takes them off with riderId null) and notes
 * it in the order history. Seller RLS: the rider and order must be the shop's.
 * With `pool` (system or admin scope only, the database checks), the rider is
 * an approved TownMart pool rider instead, paid `pool.payKobo`.
 * Returns what changed: the caller queues the "rider.assigned" notice with
 * `assignedAt` (the rider's job link and the customer's code) after commit.
 */
export async function assignRider(
  tx: Tx,
  p: { sellerOrderId: string; businessId: string; riderId: string | null; actorUserId: string | null; pool?: { payKobo: bigint } },
): Promise<{ riderId: string | null; previousRiderId: string | null; assignedAt: Date | null }> {
  const so = await tx.sellerOrder.findFirst({
    where: { id: p.sellerOrderId, businessId: p.businessId },
    select: { id: true, status: true, deliveryMethod: true, riderId: true, deliveredAt: true },
  });
  if (!so) throw new FulfilmentError("Order not found.");
  if (so.deliveryMethod !== "delivery") throw new FulfilmentError("Only delivery orders need a rider.");
  if (!(RIDER_STATUSES as readonly string[]).includes(so.status)) throw new FulfilmentError("This order is past the point of changing its rider.");
  if (so.riderId === p.riderId) return { riderId: p.riderId, previousRiderId: so.riderId, assignedAt: null };

  let note: string;
  if (p.riderId) {
    const rider = p.pool
      ? await tx.rider.findFirst({ where: { id: p.riderId, businessId: null, status: "approved", isActive: true }, select: { name: true } })
      : await tx.rider.findFirst({ where: { id: p.riderId, businessId: p.businessId, isActive: true }, select: { name: true } });
    if (!rider) throw new FulfilmentError(p.pool ? "That TownMart rider can't take jobs right now." : "That rider isn't one of your active riders.");
    const who = p.pool ? `TownMart rider ${rider.name}` : rider.name;
    note = so.riderId ? `Rider changed to ${who}` : `Rider assigned: ${who}`;
  } else {
    note = "Rider removed";
  }
  // A new assignment time also means a new job link and delivery code (lib/fulfilment/rider-job.ts).
  const assignedAt = p.riderId ? new Date() : null;
  await tx.sellerOrder.update({
    where: { id: so.id },
    data: { riderId: p.riderId, riderAssignedAt: assignedAt, pickedUpAt: null, riderPayKobo: p.riderId && p.pool ? p.pool.payKobo : null },
  });
  await recordStatus(tx, { sellerOrderId: so.id, businessId: p.businessId, from: so.status, to: so.status, actorUserId: p.actorUserId, note });
  return { riderId: p.riderId, previousRiderId: so.riderId, assignedAt };
}
