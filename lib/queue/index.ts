import { Queue } from "bullmq";
import type { EmailMessage } from "@/lib/notifications/email";
import type { SmsMessage } from "@/lib/notifications/sms";
import { redis } from "@/lib/redis";

/** Queue names shared by producers (web app) and consumers (worker/). */
export const QUEUES = {
  notifications: "notifications",
  maintenance: "maintenance",
  imports: "imports",
  orders: "orders",
} as const;

export type NotificationJobs = {
  "email.send": EmailMessage;
  "sms.send": SmsMessage;
  "stock.low": { businessId: string; variantIds: string[] };
};
export type ImportJobs = { "products.csv": { importJobId: string; businessId: string } };
export type OrderJobs = {
  "order.confirmed": { kind: "order.confirmed"; orderId: string };
  "payment.event": { kind: "payment.event"; eventId: string };
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
  const jobId = data.kind === "order.confirmed" ? `order-confirmed-${data.orderId}` : `payment-event-${data.eventId}`;
  await ordersQueue().add(data.kind, data, { jobId });
}

const globalForQueues = globalThis as unknown as { notificationsQueue?: Queue; importsQueue?: Queue };

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
