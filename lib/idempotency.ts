import "server-only";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

/**
 * One-time keys for requests a phone may send twice: a shopper on a weak
 * connection taps Pay, the order is placed, the answer is lost on the way back
 * and the phone sends the same request again. The second request gets the
 * first one's answer instead of placing a second order.
 *
 * If Redis can't be reached the request goes ahead unguarded, as it did
 * before; the cart (emptied by the first order) still stops a second one.
 */
export type Claim<T> = { state: "new" } | { state: "busy" } | { state: "done"; value: T };

const PENDING = "pending";

/** Claims `key` for this request, or reports that an earlier one is still running or has finished. */
export async function claimOnce<T>(key: string, pendingSeconds: number): Promise<Claim<T>> {
  try {
    const set = await redis.set(`idem:${key}`, PENDING, "EX", pendingSeconds, "NX");
    if (set === "OK") return { state: "new" };
    const value = await redis.get(`idem:${key}`);
    if (value === null) return claimOnce(key, pendingSeconds); // Expired in between.
    if (value === PENDING) return { state: "busy" };
    return { state: "done", value: JSON.parse(value) as T };
  } catch (err) {
    logger.warn({ err }, "idempotency key unavailable; continuing without it");
    return { state: "new" };
  }
}

/** Stores the answer for repeats of the same request. */
export async function settleOnce<T>(key: string, value: T, keepSeconds: number): Promise<void> {
  await redis.set(`idem:${key}`, JSON.stringify(value), "EX", keepSeconds).catch((err) => logger.warn({ err }, "idempotency settle failed"));
}

/** Frees the key after a failure, so the shopper can fix the problem and send again. */
export async function releaseOnce(key: string): Promise<void> {
  await redis.del(`idem:${key}`).catch(() => 0);
}

/** A key the phone made: a UUID, nothing else. */
export const requestKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
