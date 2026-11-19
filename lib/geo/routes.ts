import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";
import { roadMetres, type LatLng } from "./distance";

/**
 * Road distance between a shop and a customer, for delivery fees.
 *
 * With GOOGLE_MAPS_API_KEY set, the driving distance comes from Google's
 * Routes API (Compute Routes, Essentials: 10,000 free a month, then about $5
 * per 1,000). Each answer is kept for 30 days per shop and ~100 m customer
 * spot, so a shopper re-opening checkout costs nothing more, and the order
 * is charged exactly what the quote showed. Without a key, or when Google
 * can't be reached in time, it falls back to straight line × road factor, so
 * checkout never blocks on the network.
 */

export type RoadDistance = { metres: number; method: "road" | "estimate" };

const CACHE_TTL_S = 30 * 24 * 3600;
const GOOGLE_TIMEOUT_MS = 2500;
const CACHE_TIMEOUT_MS = 300;
const ENDPOINT = "https://routes.googleapis.com/directions/v2:computeRoutes";

/** About 100 m: close enough for a delivery fee, coarse enough to reuse answers. */
const snap = (p: LatLng): LatLng => ({ lat: Math.round(p.lat * 1000) / 1000, lng: Math.round(p.lng * 1000) / 1000 });
const cacheKey = (shop: LatLng, to: LatLng) => `geo:road:v1:${shop.lat.toFixed(5)},${shop.lng.toFixed(5)}:${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]).catch(() => null);
}

/** Calls Google Routes for the driving distance in metres; null on any failure. */
export async function googleRoadMetres(from: LatLng, to: LatLng, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<number | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "routes.distanceMeters" },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_UNAWARE",
      }),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "google routes request failed");
      return null;
    }
    const body = (await res.json()) as { routes?: { distanceMeters?: number }[] };
    const m = body.routes?.[0]?.distanceMeters;
    return typeof m === "number" && Number.isFinite(m) && m >= 0 ? Math.round(m) : null;
  } catch (err) {
    logger.warn({ err }, "google routes unreachable");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function roadDistance(shop: LatLng, customer: LatLng, roadFactor: number): Promise<RoadDistance> {
  const to = snap(customer);
  const estimate: RoadDistance = { metres: roadMetres(shop, to, roadFactor), method: "estimate" };
  const apiKey = env().GOOGLE_MAPS_API_KEY;
  if (!apiKey) return estimate;
  const key = cacheKey(shop, to);
  const cached = await withTimeout(redis.get(key), CACHE_TIMEOUT_MS);
  if (cached && /^\d+$/.test(cached)) return { metres: Number(cached), method: "road" };
  const metres = await googleRoadMetres(shop, to, apiKey);
  if (metres === null) return estimate;
  await withTimeout(redis.set(key, String(metres), "EX", CACHE_TTL_S), CACHE_TIMEOUT_MS);
  return { metres, method: "road" };
}
