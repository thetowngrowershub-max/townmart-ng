import IORedis, { type Redis } from "ioredis";

const globalForRedis = globalThis as unknown as { redis?: Redis };

function createRedis(): Redis {
  return new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    // Required by BullMQ for blocking commands.
    maxRetriesPerRequest: null,
    lazyConnect: true,
  });
}

/** Shared Redis connection (rate limits, locks, idempotency keys, queue producers). */
export const redis = globalForRedis.redis ?? createRedis();
if (process.env.NODE_ENV !== "production") globalForRedis.redis = redis;

/** A fresh connection, for BullMQ workers that need their own blocking connection. */
export const newRedisConnection = createRedis;
