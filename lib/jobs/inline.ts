import { after } from "next/server";
import { logger } from "@/lib/logger";
import type { QueueName } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { intervalMinutes } from "./schedule";
import { trackJobRun } from "@/worker/job-runs";
import { maintenanceJobs } from "@/worker/jobs/maintenance";

/**
 * Background jobs for hosts that can't run the worker (Vercel). A queued job
 * runs in the same web process straight after the response is sent, using the
 * worker's own handlers (lib/jobs/handlers.ts). Jobs queued while others run
 * (a refund that sends a notice) join the same pass. Job ids still
 * de-duplicate, through Redis, as BullMQ's would.
 */

type Task = { queue: QueueName; name: string; data: unknown; id?: string };

const ATTEMPTS = 3;
const state = globalThis as unknown as { inlineJobs?: { pending: Task[]; draining: boolean } };
const jobs = (state.inlineJobs ??= { pending: [], draining: false });

export async function runInline(task: Task): Promise<void> {
  if (task.id) {
    const fresh = await redis.set(`inline-job:${task.queue}:${task.id}`, "1", "EX", 7 * 86_400, "NX");
    if (!fresh) return;
  }
  jobs.pending.push(task);
  if (jobs.draining) return;
  jobs.draining = true;
  try {
    after(drain);
  } catch {
    // Outside a request (a script): run now.
    await drain();
  }
}

async function drain(): Promise<void> {
  try {
    const { jobHandlers } = await import("./handlers");
    for (let task = jobs.pending.shift(); task; task = jobs.pending.shift()) {
      for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        try {
          await jobHandlers[task.queue]({ id: task.id, name: task.name, data: task.data });
          break;
        } catch (err) {
          logger.error({ err, queue: task.queue, job: task.name, jobId: task.id, attempt }, "inline job failed");
          if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, 1_000 * attempt));
        }
      }
    }
  } finally {
    jobs.draining = false;
  }
}

/**
 * Runs the scheduled jobs that are due. Called after page views on hosts
 * without a worker (app/api/jobs/tick). A Redis key per job holds it back
 * until its interval has passed, so many visitors don't run it many times.
 */
export async function runDueMaintenance(): Promise<string[]> {
  const ran: string[] = [];
  for (const [name, def] of Object.entries(maintenanceJobs)) {
    const due = await redis.set(`inline-maintenance:${name}`, "1", "EX", intervalMinutes(def.pattern) * 60, "NX");
    if (!due) continue;
    try {
      await trackJobRun(name, def.run);
      ran.push(name);
    } catch (err) {
      logger.error({ err, job: name }, "inline maintenance job failed");
    }
  }
  return ran;
}
