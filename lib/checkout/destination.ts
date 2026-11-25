import type { Tx } from "@/lib/db";
import { resolveCustomerPoint, type PointProblem } from "@/lib/geo/customer-location";
import type { CustomerPoint, LatLng } from "@/lib/geo/distance";

export type Destination = { stateId: number; lgaId: number; point: CustomerPoint | null };

/**
 * Where checkout is delivering to, with its point on the map. A saved address
 * belongs to `userId` (the caller checks), and a new one is just a state and
 * LGA until it's placed. `gps` is the shopper's location when they said they're
 * at the address.
 */
export async function loadDestination(
  tx: Tx,
  input: { userId: string | null; addressId?: string | null; stateId?: number; lgaId?: number; gps?: LatLng | null },
): Promise<{ destination: Destination | null; problem: PointProblem }> {
  if (input.addressId && input.userId) {
    const a = await tx.address.findFirst({
      where: { id: input.addressId, userId: input.userId },
      select: { stateId: true, lgaId: true, latitude: true, longitude: true, lga: { select: { slug: true, state: { select: { slug: true } } } } },
    });
    if (!a) return { destination: null, problem: null };
    const r = resolveCustomerPoint({ gps: input.gps, pinned: a, area: { stateSlug: a.lga.state.slug, lgaSlug: a.lga.slug } });
    return { destination: { stateId: a.stateId, lgaId: a.lgaId, point: r.point }, problem: r.problem };
  }
  if (input.stateId && input.lgaId) {
    const lga = await tx.lga.findFirst({ where: { id: input.lgaId, stateId: input.stateId }, select: { slug: true, state: { select: { slug: true } } } });
    if (!lga) return { destination: null, problem: null };
    const r = resolveCustomerPoint({ gps: input.gps, area: { stateSlug: lga.state.slug, lgaSlug: lga.slug } });
    return { destination: { stateId: input.stateId, lgaId: input.lgaId, point: r.point }, problem: r.problem };
  }
  return { destination: null, problem: null };
}
