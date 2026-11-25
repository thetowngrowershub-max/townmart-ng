import { after, NextResponse } from "next/server";
import { runDueMaintenance } from "@/lib/jobs/inline";
import { logger } from "@/lib/logger";
import { jobsInline } from "@/lib/platform";
import { redis } from "@/lib/redis";

// Each pass may take a while (refunds, escrow, payouts); it runs after the response.
export const maxDuration = 60;

/**
 * Runs due scheduled jobs on hosts without a worker; page views call it (components/test-mode/maintenance-tick.tsx).
 * Anyone may call it, so it does at most one pass a minute, and each job keeps its own interval.
 */
export async function POST() {
  if (!jobsInline()) return new NextResponse(null, { status: 404 });
  const go = await redis.set("inline-maintenance:tick", "1", "EX", 60, "NX");
  if (go) {
    after(async () => {
      const ran = await runDueMaintenance();
      if (ran.length) logger.info({ ran }, "scheduled jobs ran");
    });
  }
  return new NextResponse(null, { status: 204 });
}
