import { runProductImport } from "@/lib/catalogue/import";
import { sendLowStockAlert } from "@/lib/catalogue/low-stock-alert";
import { sendFulfilmentNotice } from "@/lib/fulfilment/notify";
import { logger } from "@/lib/logger";
import { emailProvider, type EmailMessage } from "@/lib/notifications/email";
import { smsProvider } from "@/lib/notifications/sms";
import { sendOrderConfirmed } from "@/lib/orders/notify";
import { processPaymentEvent } from "@/lib/orders/payment";
import { buildDataExport } from "@/lib/privacy/export";
import type { ImportJobs, NotificationJobs, OrderJobs, PrivacyJobs, QueueName } from "@/lib/queue";
import { trackJobRun } from "@/worker/job-runs";
import { maintenanceJobs } from "@/worker/jobs/maintenance";

/**
 * What each queue's jobs do. The worker (worker/index.ts) runs these from
 * BullMQ; hosts without a worker run them in the web process (./inline.ts).
 * Only the fields used here are needed, so a BullMQ Job fits.
 */
export type JobLike = { id?: string | null; name: string; data: unknown };

export async function handleNotification(job: JobLike) {
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

export async function handleImport(job: JobLike) {
  if (job.name !== "products.csv") throw new Error(`Unknown imports job: ${job.name}`);
  const { importJobId, businessId } = job.data as ImportJobs["products.csv"];
  const result = await runProductImport(importJobId, businessId);
  logger.info({ importJobId, ...result }, "product import finished");
  return result;
}

export async function handleOrder(job: JobLike) {
  switch (job.name) {
    case "order.confirmed": {
      const { orderId } = job.data as OrderJobs["order.confirmed"];
      const sent = await sendOrderConfirmed(orderId);
      logger.info({ jobId: job.id, orderId, sent }, "order confirmation processed");
      return;
    }
    case "payment.event": {
      const { eventId } = job.data as OrderJobs["payment.event"];
      await processPaymentEvent(eventId);
      logger.info({ jobId: job.id, eventId }, "payment event processed");
      return;
    }
    case "fulfilment.notice": {
      const { notice } = job.data as OrderJobs["fulfilment.notice"];
      await sendFulfilmentNotice(notice);
      logger.info({ jobId: job.id, type: notice.type }, "notice processed");
      return;
    }
    default:
      throw new Error(`Unknown orders job: ${job.name}`);
  }
}

export async function handlePrivacy(job: JobLike) {
  if (job.name !== "privacy.export") throw new Error(`Unknown privacy job: ${job.name}`);
  const { requestId } = job.data as PrivacyJobs["privacy.export"];
  const result = await buildDataExport(requestId);
  logger.info({ jobId: job.id, requestId, result }, "data export processed");
  return result;
}

export async function handleMaintenance(job: JobLike) {
  const def = maintenanceJobs[job.name];
  if (!def) throw new Error(`Unknown maintenance job: ${job.name}`);
  const result = await trackJobRun(job.name, def.run);
  logger.info({ job: job.name, result }, "maintenance job finished");
  return result;
}

export const jobHandlers: Record<QueueName, (job: JobLike) => Promise<unknown>> = {
  notifications: handleNotification,
  imports: handleImport,
  orders: handleOrder,
  privacy: handlePrivacy,
  maintenance: handleMaintenance,
};
