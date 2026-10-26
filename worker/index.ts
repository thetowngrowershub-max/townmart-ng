/**
 * TownMart background worker (BullMQ). Runs as its own process:
 *   pnpm worker        (or the `worker` service in docker-compose.yml)
 *
 * Queues:
 *   notifications — emails, SMS and low-stock alerts
 *   imports       — seller CSV product imports
 *   maintenance   — scheduled clean-up jobs, recorded in job_runs
 */
import "dotenv/config";
import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { runProductImport } from "@/lib/catalogue/import";
import { sendLowStockAlert } from "@/lib/catalogue/low-stock-alert";
import { emailProvider, type EmailMessage } from "@/lib/notifications/email";
import { smsProvider } from "@/lib/notifications/sms";
import { QUEUES, type ImportJobs, type NotificationJobs } from "@/lib/queue";
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
    case "sms.send": {
      const message = job.data as NotificationJobs["sms.send"];
      const { id } = await smsProvider().send(message);
      // Never log the body: it holds one-time codes.
      logger.info({ jobId: job.id, provider: smsProvider().name, messageId: id }, "sms sent");
      return;
    }
    case "stock.low": {
      const { businessId, variantIds } = job.data as NotificationJobs["stock.low"];
      const sent = await sendLowStockAlert(businessId, variantIds);
      logger.info({ jobId: job.id, businessId, items: sent }, "low-stock alert processed");
      return;
    }
    default:
      throw new Error(`Unknown notifications job: ${job.name}`);
  }
}

async function handleImport(job: Job) {
  if (job.name !== "products.csv") throw new Error(`Unknown imports job: ${job.name}`);
  const { importJobId, businessId } = job.data as ImportJobs["products.csv"];
  const result = await runProductImport(importJobId, businessId);
  logger.info({ importJobId, ...result }, "product import finished");
  return result;
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
    new Worker(QUEUES.imports, handleImport, { connection: newRedisConnection(), concurrency: 2 }),
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
