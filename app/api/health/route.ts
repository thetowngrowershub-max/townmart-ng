import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { isTestMode } from "@/lib/platform";
import { checkGoogleRoutes } from "@/lib/geo/routes";
import { paymentsStatus } from "@/lib/payments";
import { redis } from "@/lib/redis";
import { channelLog } from "@/lib/notifications/delivery-log";
import { emailStatus, smsStatus } from "@/lib/notifications/status";
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
 * Whether ?key= matches HEALTH_KEY. Read straight from process.env, so a live
 * site whose settings don't validate can still show what's wrong.
 */
function detailsKeyMatches(req: NextRequest): boolean {
  const want = process.env.HEALTH_KEY?.trim();
  const got = req.nextUrl.searchParams.get("key");
  if (!want || want.length < 24 || !got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Liveness/readiness probe for Docker and the reverse proxy. Reveals no details,
 * except on a test-mode site, or with ?key=<HEALTH_KEY> on a live one, where it
 * names what failed (never a secret) so setup problems can be read without
 * server logs.
 */
export async function GET(req: NextRequest) {
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
      ...(isTestMode() || detailsKeyMatches(req)
        ? {
            mode: isTestMode() ? "test" : "live",
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
            messages:
              settings.status === "fulfilled"
                ? {
                    sms: { ...smsStatus(), ...(cache.status === "fulfilled" ? await channelLog("sms", 3).catch(() => ({})) : {}) },
                    email: { ...emailStatus(), ...(cache.status === "fulfilled" ? await channelLog("email", 3).catch(() => ({})) : {}) },
                  }
                : null,
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
