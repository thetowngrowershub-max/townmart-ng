import { withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { anonymiseAccount } from "@/lib/privacy/account";
import { enqueueEmail } from "@/lib/queue";
import { daysAgo, getRetention } from "./retention";

/**
 * The scheduled retention jobs (worker/jobs/maintenance.ts). Each reads its
 * period from `retention_settings` at run time, so changes in the compliance
 * centre apply from the next run. Order, payment, refund and ledger records
 * are kept for six years by law and are never touched here; nor is the
 * append-only audit log.
 */

const periods = () => withSystemContext((tx) => getRetention(tx));

/** Carts nobody has touched (cart or its items) for the period. */
export async function purgeAbandonedCarts(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = daysAgo((await periods()).abandoned_carts, now);
  const deleted = await withSystemContext((tx) =>
    tx.$executeRaw`
      DELETE FROM carts c
       WHERE c.updated_at < ${cutoff}
         AND NOT EXISTS (SELECT 1 FROM cart_items i WHERE i.cart_id = c.id AND i.updated_at >= ${cutoff})`,
  );
  return { deleted };
}

/**
 * Sign-ups that never confirmed their email and never did anything: no
 * orders, bookings, reviews, shop, Google link or verified phone, and no role
 * beyond customer (staff accounts are never removed here).
 */
export async function purgeUnverifiedAccounts(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = daysAgo((await periods()).unverified_accounts, now);
  const deleted = await withSystemContext((tx) =>
    tx.$executeRaw`
      DELETE FROM users u
       WHERE u.email_verified_at IS NULL AND u.phone_verified_at IS NULL
         AND u.status = 'active' AND u.created_at < ${cutoff}
         AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role <> 'customer')
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.customer_user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM businesses s WHERE s.owner_user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM business_staff st WHERE st.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM data_subject_requests d WHERE d.user_id = u.id)`,
  );
  return { deleted };
}

/** Background job logs and in-app notifications older than the period. */
export async function purgeOldLogs(now = new Date()): Promise<{ jobRuns: number; notifications: number }> {
  const cutoff = daysAgo((await periods()).logs, now);
  return withSystemContext(async (tx) => {
    const jobRuns = await tx.jobRun.deleteMany({ where: { startedAt: { lt: cutoff }, status: { not: "running" } } });
    const notifications = await tx.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
    return { jobRuns: jobRuns.count, notifications: notifications.count };
  });
}

/** Accounts whose deletion grace period has ended: anonymised one at a time, then told. */
export async function anonymiseDeletedAccounts(now = new Date()): Promise<{ anonymised: number; failed: number }> {
  const cutoff = daysAgo((await periods()).deletion_grace, now);
  const due = await withSystemContext((tx) => tx.user.findMany({ where: { status: "pending_deletion", deletionRequestedAt: { lte: cutoff } }, select: { id: true }, take: 200 }));
  let anonymised = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      const was = await withSystemContext((tx) => anonymiseAccount(tx, id, now));
      anonymised++;
      await enqueueEmail(
        noticeTemplate({
          to: was.email,
          subject: "Your TownMart account has been deleted",
          title: "Your account has been deleted",
          lines: [
            `Hi${was.name ? ` ${was.name}` : ""},`,
            "As you asked, we've deleted your TownMart account and the personal data linked to it.",
            "We keep order, payment and refund records for six years because tax and accounting law requires it. They're no longer linked to a sign-in.",
          ],
          url: new URL("/legal/privacy", env().APP_URL).toString(),
          buttonLabel: "Read our Privacy Policy",
        }),
      );
    } catch (err) {
      failed++;
      logger.error({ err, userId: id }, "anonymising an account failed; it will be retried on the next run");
    }
  }
  return { anonymised, failed };
}

/** Public-form requests whose email was never confirmed. */
export async function purgeUnverifiedRequests(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = daysAgo((await periods()).unverified_requests, now);
  const { count } = await withSystemContext((tx) => tx.dataSubjectRequest.deleteMany({ where: { status: "unverified", createdAt: { lt: cutoff } } }));
  return { deleted: count };
}
