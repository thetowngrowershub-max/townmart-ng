/**
 * TownMart background worker (BullMQ). Runs as its own process:
 *   pnpm worker        (or the `worker` service in docker-compose.yml)
 *
 * Queues:
 *   notifications — emails, SMS and low-stock alerts
 *   imports       — seller CSV product imports
 *   orders        — order confirmations, payment webhooks, and order/booking/message notices
 *   privacy       — data exports for the Privacy Centre
 *   maintenance   — scheduled clean-up jobs, recorded in job_runs
 */
import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { handleImport, handleMaintenance, handleNotification, handleOrder, handlePrivacy } from "@/lib/jobs/handlers";
import { logger } from "@/lib/logger";
import { QUEUES } from "@/lib/queue";
import { newRedisConnection } from "@/lib/redis";
import { maintenanceJobs } from "./jobs/maintenance";

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
    new Worker(QUEUES.imports, handleImport, { connection: newRedisConnection(), concurrency: 2 }),
    new Worker(QUEUES.orders, handleOrder, { connection: newRedisConnection(), concurrency: 5 }),
    new Worker(QUEUES.privacy, handlePrivacy, { connection: newRedisConnection(), concurrency: 1 }),
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
