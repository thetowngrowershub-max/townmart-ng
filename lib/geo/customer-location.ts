import { SERVICE_AREAS, areaCentre } from "@/lib/service-area";
import { haversineMetres, isLatLng, roundCoord, type CustomerPoint, type LatLng } from "./distance";

/**
 * Where a delivery goes on the map, best first:
 * 1. "gps": the shopper tapped "use my location" while at the address,
 * 2. "pinned": a saved address that was pinned that way before,
 * 3. "area": the middle of the address's town, as an estimate.
 * The fee is shown before paying either way, so nobody quotes it by hand.
 */

/** How far from the middle of a service area a point can be and still count as inside it. */
export const AREA_RADIUS_M = 30_000;

/** True when the point is within reach of any service area (a phone in Lagos isn't at a Mowe address). */
export function nearServiceArea(p: LatLng): boolean {
  return SERVICE_AREAS.some((a) => haversineMetres(a.centre, p) <= AREA_RADIUS_M);
}

export type PointProblem = "outside_area" | null;

export function resolveCustomerPoint(input: {
  gps?: LatLng | null;
  pinned?: { latitude: number | null; longitude: number | null } | null;
  area: { stateSlug: string; lgaSlug: string } | null;
}): { point: CustomerPoint | null; problem: PointProblem } {
  let problem: PointProblem = null;
  if (input.gps && isLatLng(input.gps)) {
    if (nearServiceArea(input.gps)) return { point: { lat: roundCoord(input.gps.lat), lng: roundCoord(input.gps.lng), source: "gps" }, problem };
    problem = "outside_area";
  }
  const p = input.pinned;
  if (p && p.latitude !== null && p.longitude !== null) return { point: { lat: p.latitude, lng: p.longitude, source: "pinned" }, problem };
  const c = input.area ? areaCentre(input.area.stateSlug, input.area.lgaSlug) : null;
  return { point: c ? { ...c, source: "area" } : null, problem };
}

/** The cookie that remembers "near me" for search and the cart (about 100 m precision). */
export const NEAR_COOKIE = "tm_near";

export function parseNearCookie(v: string | undefined): LatLng | null {
  if (!v) return null;
  const [a, b] = v.split(",").map(Number);
  const p = { lat: a, lng: b };
  return isLatLng(p) && nearServiceArea(p) ? p : null;
}
