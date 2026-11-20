import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isTestMode } from "@/lib/platform";
import { checkGoogleRoutes } from "@/lib/geo/routes";
import { paymentsStatus } from "@/lib/payments";
import { redis } from "@/lib/redis";
import { recentPageErrors, scrub } from "@/lib/test-mode/page-errors";

export const dynamic = "force-dynamic";

/** Fails a check that hasn't answered in 8 seconds (ioredis otherwise retries forever). */
const within = <T>(p: Promise<T>, what: string) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${what} did not answer within 8 seconds`)),
        8_000,
      ),
    ),
  ]);

const reason = (c: PromiseSettledResult<unknown>) =>
  c.status === "rejected"
    ? scrub(c.reason instanceof Error ? c.reason.message : String(c.reason))
    : undefined;

/**
 * Liveness/readiness probe for Docker and the reverse proxy. Reveals no details,
 * except on a test-mode site, where it names what failed so setup problems can
 * be read without server logs.
 */
export async function GET() {
  const checks = await Promise.allSettled([
    Promise.resolve().then(() => env()),
    within(prisma.$queryRaw`SELECT 1`, "database"),
    within(redis.ping(), "redis"),
  ]);
  const ok = checks.every((c) => c.status === "fulfilled");
  if (!ok)
    logger.error(
      { checks: checks.map((c) => c.status) },
      "health check failed",
    );
  const [settings, db, cache] = checks;
  return NextResponse.json(
    {
      status: ok ? "ok" : "degraded",
      db: db.status === "fulfilled",
      redis: cache.status === "fulfilled",
      ...(isTestMode()
        ? {
            settings: settings.status === "fulfilled",
            errors: {
              settings: reason(settings),
              db: reason(db),
              redis: reason(cache),
            },
            maps: await checkGoogleRoutes().catch((e: unknown) => ({
              configured: true,
              ok: false,
              error: scrub(e instanceof Error ? e.message : String(e)),
            })),
            payments:
              settings.status === "fulfilled"
                ? await paymentsStatus().then(
                    (p) => ({ ...p, error: p.error && scrub(p.error) }),
                    (e: unknown) => ({ ok: false, error: scrub(e instanceof Error ? e.message : String(e)) }),
                  )
                : undefined,
            recentPageErrors:
              cache.status === "fulfilled"
                ? await recentPageErrors().catch(() => [])
                : [],
          }
        : {}),
    },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
