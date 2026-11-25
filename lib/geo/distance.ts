/**
 * Distances and distance-priced delivery. Pure, safe for client components.
 *
 * Distance is the straight line between two points (haversine) times a road
 * factor, because roads wind. That needs no maps API key and costs nothing per
 * order. A road-distance provider (Google Routes) can replace `roadMetres`
 * later without changing callers.
 */

export type LatLng = { lat: number; lng: number };

/** Where a location came from, best first. */
export type LocationSource = "gps" | "pinned" | "area";

export type CustomerPoint = LatLng & { source: LocationSource };

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function isLatLng(p: unknown): p is LatLng {
  if (!p || typeof p !== "object") return false;
  const { lat, lng } = p as Record<string, unknown>;
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

/** Straight-line distance in metres. */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Estimated distance by road, in whole metres. */
export function roadMetres(a: LatLng, b: LatLng, roadFactor: number): number {
  return Math.round(haversineMetres(a, b) * roadFactor);
}

export type DistanceRates = {
  /** Charged per kilometre, in kobo (₦250 = 25,000). */
  perKmKobo: bigint;
  /** Straight line times this is the road estimate (1.3 is typical for towns). */
  roadFactor: number;
  /** No delivery beyond this many road kilometres. */
  maxKm: number;
};

export type DistanceQuote = {
  metres: number;
  /** Kilometres charged: the road distance rounded up to the next whole km, at least 1. */
  chargedKm: number;
  feeKobo: bigint;
};

/** The delivery fee for a distance, or null when it's beyond the limit. */
export function priceByDistance(metres: number, rates: DistanceRates): DistanceQuote | null {
  if (metres > rates.maxKm * 1000) return null;
  const chargedKm = Math.max(1, Math.ceil(metres / 1000));
  return { metres, chargedKm, feeKobo: BigInt(chargedKm) * rates.perKmKobo };
}

/** "1.4 km" or "800 m". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.max(50, Math.round(metres / 50) * 50)} m`;
  return `${(metres / 1000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/** Rounds a coordinate to 5 decimals (about a metre), so stored points don't claim false precision. */
export const roundCoord = (n: number) => Math.round(n * 1e5) / 1e5;
