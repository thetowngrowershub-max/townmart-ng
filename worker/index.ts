/**
 * TownMart background worker (BullMQ). Runs as its own process:
 *   pnpm worker        (or the `worker` service in docker-compose.yml)
 *
 * Queues:
 *   notifications — emails (SMS and in-app arrive with checkout)
 *   maintenance   — scheduled clean-up jobs, recorded in job_runs
 */
import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emailProvider, type EmailMessage } from "@/lib/notifications/email";
import { QUEUES } from "@/lib/queue";
import { newRedisConnection } from "@/lib/redis";
import { maintenanceJobs } from "./jobs/maintenance";
import { trackJobRun } from "./job-runs";

async function handleNotification(job: Job) {
  switch (job.name) {
    case "email.send": {
      const message = job.data as EmailMessage;
      const { id } = await emailProvider().send(message);
      logger.info({ jobId: job.id, provider: emailProvider().name, messageId: id }, "email sent");
      return;
    }
    default:
      throw new Error(`Unknown notifications job: ${job.name}`);
  }
}

async function handleMaintenance(job: Job) {
  const def = maintenanceJobs[job.name];
  if (!def) throw new Error(`Unknown maintenance job: ${job.name}`);
  const result = await trackJobRun(job.name, def.run);
  logger.info({ job: job.name, result }, "maintenance job finished");
  return result;
}

async function main() {
  const maintenanceQueue = new Queue(QUEUES.maintenance, { connection: newRedisConnection() });
  for (const [name, def] of Object.entries(maintenanceJobs)) {
    await maintenanceQueue.upsertJobScheduler(
      name,
      { pattern: def.pattern, tz: "Africa/Lagos" },
      { name, opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );
  }

  const workers = [
    new Worker(QUEUES.notifications, handleNotification, { connection: newRedisConnection(), concurrency: 5 }),
    new Worker(QUEUES.maintenance, handleMaintenance, { connection: newRedisConnection(), concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on("failed", (job, err) => logger.error({ queue: w.name, job: job?.name, jobId: job?.id, attempts: job?.attemptsMade, err }, "job failed"));
  }
  logger.info({ queues: workers.map((w) => w.name) }, "worker started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    await Promise.all(workers.map((w) => w.close()));
    await maintenanceQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  logger.fatal({ err }, "worker failed to start");
  process.exit(1);
});
