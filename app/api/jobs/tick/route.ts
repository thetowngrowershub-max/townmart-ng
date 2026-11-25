import { timingSafeEqual } from "node:crypto";
import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runDueMaintenance } from "@/lib/jobs/inline";
import { logger } from "@/lib/logger";
import { jobsInline } from "@/lib/platform";
import { redis } from "@/lib/redis";

// Each pass may take a while (refunds, escrow, payouts); it runs after the response.
export const maxDuration = 60;

/** Starts one pass of the due scheduled jobs, at most once a minute however often it's asked. */
async function tick() {
  const go = await redis.set("inline-maintenance:tick", "1", "EX", 55, "NX");
  if (go) {
    after(async () => {
      const ran = await runDueMaintenance();
      if (ran.length) logger.info({ ran }, "scheduled jobs ran");
    });
  }
  return Boolean(go);
}

/**
 * Runs due scheduled jobs on hosts without a worker; page views call it (components/test-mode/maintenance-tick.tsx).
 * Anyone may call it, so it does at most one pass a minute, and each job keeps its own interval.
 */
export async function POST() {
  if (!jobsInline()) return new NextResponse(null, { status: 404 });
  await tick();
  return new NextResponse(null, { status: 204 });
}

function authorised(header: string | null): boolean {
  const secret = env().CRON_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The same, for a scheduler that calls every minute (cron-job.org, or Vercel
 * Cron), so jobs run on time when nobody is visiting. It must send
 * "Authorization: Bearer <CRON_SECRET>", as Vercel Cron does by itself.
 */
export async function GET(req: NextRequest) {
  if (!jobsInline()) return new NextResponse(null, { status: 404 });
  if (!authorised(req.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const started = await tick();
  return NextResponse.json({ started }, { headers: { "Cache-Control": "no-store" } });
}
