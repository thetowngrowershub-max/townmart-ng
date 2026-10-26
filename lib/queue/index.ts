import { Queue } from "bullmq";
import type { EmailMessage } from "@/lib/notifications/email";
import { redis } from "@/lib/redis";

/** Queue names shared by producers (web app) and consumers (worker/). */
export const QUEUES = {
  notifications: "notifications",
  maintenance: "maintenance",
} as const;

export type NotificationJobs = { "email.send": EmailMessage };

const globalForQueues = globalThis as unknown as { notificationsQueue?: Queue };

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
