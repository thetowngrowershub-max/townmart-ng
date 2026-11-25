import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { NEAR_COOKIE, parseNearCookie } from "./customer-location";
import type { LatLng } from "./distance";

/**
 * Where the shopper is, for "nearest" sorting and distances on listings: the
 * location they last shared on this device, else their default address pin.
 * Null when we don't know, and nothing is guessed.
 */
export async function nearMe(): Promise<LatLng | null> {
  const fromCookie = parseNearCookie((await cookies()).get(NEAR_COOKIE)?.value);
  if (fromCookie) return fromCookie;
  const user = await getCurrentUser();
  if (!user) return null;
  const a = await withRls({ userId: user.id }, (tx) =>
    tx.address.findFirst({ where: { userId: user.id, latitude: { not: null } }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }], select: { latitude: true, longitude: true } }),
  );
  return a?.latitude != null && a.longitude != null ? { lat: a.latitude, lng: a.longitude } : null;
}
