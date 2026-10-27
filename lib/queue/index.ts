import { Queue } from "bullmq";
import { logger } from "@/lib/logger";
import type { EmailMessage } from "@/lib/notifications/email";
import type { SmsMessage } from "@/lib/notifications/sms";
import { redis } from "@/lib/redis";

/** Queue names shared by producers (web app) and consumers (worker/). */
export const QUEUES = {
  notifications: "notifications",
  maintenance: "maintenance",
  imports: "imports",
  orders: "orders",
  privacy: "privacy",
} as const;

export type NotificationJobs = {
  "email.send": EmailMessage;
  "sms.send": SmsMessage;
  "stock.low": { businessId: string; variantIds: string[] };
};
export type PrivacyJobs = { "privacy.export": { requestId: string } };
export type ImportJobs = { "products.csv": { importJobId: string; businessId: string } };
/** Status changes and messages that the customer or seller is told about. */
export type FulfilmentNotice =
  | { type: "order.status"; sellerOrderId: string; status: string }
  /** `ref` tells repeat changes apart (a booking moved twice), so neither notice is de-duplicated away. */
  | { type: "booking.status"; bookingId: string; status: string; by: "seller" | "customer" | "system"; ref?: string }
  | { type: "message.new"; messageId: string }
  | { type: "refund.update"; refundId: string; status: string }
  | { type: "dispute.update"; disputeId: string; event: "opened" | "message" | "resolved"; messageId?: string }
  | { type: "payout.update"; payoutId: string; status: string };

export type OrderJobs = {
  "order.confirmed": { kind: "order.confirmed"; orderId: string };
  "payment.event": { kind: "payment.event"; eventId: string };
  "fulfilment.notice": { kind: "fulfilment.notice"; notice: FulfilmentNotice };
};

const globalForOrders = globalThis as unknown as { ordersQueue?: Queue };

function ordersQueue(): Queue {
  globalForOrders.ordersQueue ??= new Queue(QUEUES.orders, {
    connection: redis,
    defaultJobOptions: { attempts: 8, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: 1000, removeOnFail: { age: 30 * 24 * 3600 } },
  });
  return globalForOrders.ordersQueue;
}

/** Order follow-ups (notifications) and webhook processing. Job ids de-duplicate repeats. */
export async function enqueueOrderEvent(data: OrderJobs[keyof OrderJobs]): Promise<void> {
  const jobId =
    data.kind === "order.confirmed"
      ? `order-confirmed-${data.orderId}`
      : data.kind === "payment.event"
        ? `payment-event-${data.eventId}`
        : `notice-${noticeKey(data.notice)}`;
  await ordersQueue().add(data.kind, data, { jobId });
}

function noticeKey(n: FulfilmentNotice): string {
  switch (n.type) {
    case "order.status":
      return `order-${n.sellerOrderId}-${n.status}`;
    case "booking.status":
      return `booking-${n.bookingId}-${n.status}${n.ref ? `-${n.ref}` : ""}`;
    case "message.new":
      return `message-${n.messageId}`;
    case "refund.update":
      return `refund-${n.refundId}-${n.status}`;
    case "dispute.update":
      return `dispute-${n.disputeId}-${n.event}${n.messageId ? `-${n.messageId}` : ""}`;
    case "payout.update":
      return `payout-${n.payoutId}-${n.status}`;
  }
}

/** Tells the other side about a change. Never throws: a queue outage mustn't undo the change itself. */
export async function enqueueNotice(notice: FulfilmentNotice): Promise<void> {
  try {
    await enqueueOrderEvent({ kind: "fulfilment.notice", notice });
  } catch (err) {
    logger.error({ err, notice }, "could not queue a notice");
  }
}

const globalForQueues = globalThis as unknown as { notificationsQueue?: Queue; importsQueue?: Queue; privacyQueue?: Queue };

function notificationsQueue(): Queue {
  globalForQueues.notificationsQueue ??= new Queue(QUEUES.notifications, {
    connection: redis,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      // Email jobs can contain one-time links; don't keep them in Redis.
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return globalForQueues.notificationsQueue;
}

export async function enqueueEmail(message: EmailMessage): Promise<void> {
  await notificationsQueue().add("email.send", message satisfies NotificationJobs["email.send"]);
}

export async function enqueueSms(message: SmsMessage): Promise<void> {
  // OTPs go stale quickly: retry fast and give up after a few minutes.
  await notificationsQueue().add("sms.send", message satisfies NotificationJobs["sms.send"], {
    attempts: 3,
    backoff: { type: "fixed", delay: 5_000 },
  });
}

/** Low-stock alert for variants that just crossed their threshold. The worker de-duplicates per day. */
export async function enqueueLowStockAlert(data: NotificationJobs["stock.low"]): Promise<void> {
  await notificationsQueue().add("stock.low", data, { attempts: 3 });
}

function importsQueue(): Queue {
  globalForQueues.importsQueue ??= new Queue(QUEUES.imports, {
    connection: redis,
    defaultJobOptions: { attempts: 1, removeOnComplete: 100, removeOnFail: 500 },
  });
  return globalForQueues.importsQueue;
}

export async function enqueueProductImport(data: ImportJobs["products.csv"]): Promise<void> {
  await importsQueue().add("products.csv", data, { jobId: data.importJobId });
}

/** Data exports for the Privacy Centre. One job per request. */
export async function enqueueDataExport(data: PrivacyJobs["privacy.export"]): Promise<void> {
  globalForQueues.privacyQueue ??= new Queue(QUEUES.privacy, {
    connection: redis,
    defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 100, removeOnFail: { age: 30 * 24 * 3600 } },
  });
  await globalForQueues.privacyQueue.add("privacy.export", data, { jobId: `export-${data.requestId}` });
}
