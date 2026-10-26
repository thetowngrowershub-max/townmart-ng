import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

/**
 * Fixed-window rate limiter on Redis. `key` should include the action and the
 * subject, e.g. `auth:sign-in:ip:<ipHash>`.
 *
 * If Redis is unreachable the request is allowed and an error is logged, so a
 * cache outage degrades protection rather than taking sign-in down. Account
 * lockout (stored in Postgres) still applies in that case.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const results = await redis.multi().incr(redisKey).expire(redisKey, windowSeconds, "NX").ttl(redisKey).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: count <= limit ? 0 : Math.max(ttl, 1),
    };
  } catch (err) {
    logger.error({ err, key }, "rate limiter unavailable; allowing request");
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
}
