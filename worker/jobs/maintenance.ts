import { prisma } from "@/lib/db";
import { expireUnpaidOrders } from "@/lib/orders/payment";

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

type MaintenanceJob = { pattern: string; run: () => Promise<Record<string, number>> };

/** Scheduled jobs (cron patterns in Africa/Lagos time). */
export const maintenanceJobs: Record<string, MaintenanceJob> = {
  "sessions.purge-expired": { pattern: "15 * * * *", run: purgeExpiredSessions },
  "tokens.purge-expired": { pattern: "45 * * * *", run: purgeExpiredTokens },
  // Gives back stock held for orders whose payment window has passed.
  "orders.expire-unpaid": { pattern: "* * * * *", run: () => expireUnpaidOrders() },
};
