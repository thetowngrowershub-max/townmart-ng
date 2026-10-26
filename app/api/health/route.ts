import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

/** Liveness/readiness probe for Docker and the reverse proxy. Reveals no details. */
export async function GET() {
  const checks = await Promise.allSettled([prisma.$queryRaw`SELECT 1`, redis.ping()]);
  const ok = checks.every((c) => c.status === "fulfilled");
  if (!ok) logger.error({ checks: checks.map((c) => c.status) }, "health check failed");
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", db: checks[0].status === "fulfilled", redis: checks[1].status === "fulfilled" },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
