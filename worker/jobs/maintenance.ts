import { prisma, withSystemContext } from "@/lib/db";
import { sendBookingReminders } from "@/lib/bookings/reminders";
import { autoCompleteDelivered } from "@/lib/fulfilment/orders";
import { escalateOverdueRefunds } from "@/lib/disputes/core";
import { expireUnpaidOrders } from "@/lib/orders/payment";
import { releaseDueEscrow } from "@/lib/payouts/escrow";
import { runPayouts, syncPayouts } from "@/lib/payouts/payouts";
import { processRefunds } from "@/lib/refunds/core";
import { getCheckoutSettings } from "@/lib/settings";

/** Deletes expired sessions so revoked/expired logins don't accumulate. */
export async function purgeExpiredSessions(): Promise<{ deleted: number }> {
  const { count } = await prisma.session.deleteMany({ where: { expires: { lt: new Date() } } });
  return { deleted: count };
}

/** Deletes expired email-verification and password-reset tokens, and spent OTP codes. */
export async function purgeExpiredTokens(): Promise<{ tokens: number; otps: number }> {
  const now = new Date();
  const [tokens, otps] = await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { expires: { lt: now } } }),
    prisma.otpCode.deleteMany({ where: { OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }] } }),
  ]);
  return { tokens: tokens.count, otps: otps.count };
}

/**
 * Completes delivered orders the customer never confirmed, once the
 * auto-complete period has passed; completion starts the escrow countdown.
 */
export async function completeDeliveredOrders(now = new Date()): Promise<{ completed: number }> {
  const completed = await withSystemContext(async (tx) => autoCompleteDelivered(tx, (await getCheckoutSettings(tx)).autoCompleteDays, now));
  return { completed };
}

type MaintenanceJob = { pattern: string; run: () => Promise<Record<string, number>> };

/** Scheduled jobs (cron patterns in Africa/Lagos time). */
export const maintenanceJobs: Record<string, MaintenanceJob> = {
  "sessions.purge-expired": { pattern: "15 * * * *", run: purgeExpiredSessions },
  "tokens.purge-expired": { pattern: "45 * * * *", run: purgeExpiredTokens },
  // Gives back stock held for orders whose payment window has passed.
  "orders.expire-unpaid": { pattern: "* * * * *", run: () => expireUnpaidOrders() },
  "bookings.reminders": { pattern: "*/5 * * * *", run: () => sendBookingReminders() },
  "orders.auto-complete": { pattern: "30 * * * *", run: () => completeDeliveredOrders() },
  // Sends approved refunds to the payment provider and checks on ones in progress.
  "refunds.process": { pattern: "*/2 * * * *", run: () => processRefunds() },
  // Refund requests a seller hasn't answered in time go to TownMart.
  "refunds.escalate": { pattern: "10,40 * * * *", run: async () => ({ escalated: (await escalateOverdueRefunds()).escalated.length }) },
  "escrow.release": { pattern: "*/15 * * * *", run: () => releaseDueEscrow() },
  // Daily payout run on working mornings, plus a check on transfers still in progress.
  "payouts.run": { pattern: "0 10 * * 1-5", run: () => runPayouts() },
  "payouts.sync": { pattern: "*/15 * * * *", run: () => syncPayouts() },
};
