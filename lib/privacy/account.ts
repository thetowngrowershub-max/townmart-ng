import { writeAudit } from "@/lib/audit";
import { daysFrom, getRetention } from "@/lib/compliance/retention";
import type { Tx } from "@/lib/db";
import { createDataRequest, DataRequestError } from "./requests";

/**
 * Account deletion. Asking to delete signs the person out everywhere and
 * starts a grace period (14 days by default); signing in again during it
 * cancels the deletion. When it ends, the retention job anonymises the
 * account: everything that identifies the person is removed, while order,
 * payment and refund records that tax and accounting law make us keep are
 * retained, unlinked from any sign-in.
 */

export async function requestAccountDeletion(tx: Tx, p: { userId: string; reason?: string | null; ipHash?: string | null }) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: p.userId }, select: { id: true, email: true, name: true, status: true } });
  if (user.status !== "active") throw new DataRequestError("This account can't be deleted right now.");
  if ((await tx.business.count({ where: { ownerUserId: user.id } })) > 0) {
    throw new DataRequestError("You run a shop on TownMart, so we handle deleting your account by hand. Send us a request below and we'll be in touch about closing your shop first.");
  }
  const now = new Date();
  const grace = (await getRetention(tx)).deletion_grace;
  const request = await createDataRequest(tx, {
    type: "erasure",
    userId: user.id,
    email: user.email,
    name: user.name,
    details: p.reason,
    channel: "privacy_centre",
    ipHash: p.ipHash,
    verified: true,
    dueAt: daysFrom(grace, now),
  });
  await tx.user.update({ where: { id: user.id }, data: { status: "pending_deletion", deletionRequestedAt: now } });
  await tx.session.deleteMany({ where: { userId: user.id } });
  await writeAudit(tx, { actorUserId: user.id, action: "account.deletion_requested", entityType: "user", entityId: user.id, after: { request: request.reference, anonymiseAfter: request.dueAt }, ipHash: p.ipHash });
  return request;
}

/** Signing in during the grace period: the account is active again and the request is cancelled. */
export async function restoreAccount(tx: Tx, userId: string, ipHash?: string | null): Promise<boolean> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (user?.status !== "pending_deletion") return false;
  await tx.user.update({ where: { id: userId }, data: { status: "active", deletionRequestedAt: null } });
  await tx.dataSubjectRequest.updateMany({
    where: { userId, type: "erasure", status: { in: ["open", "in_progress"] } },
    data: { status: "cancelled", resolutionNote: "Cancelled: the account holder signed in again during the grace period.", completedAt: new Date() },
  });
  await writeAudit(tx, { actorUserId: userId, action: "account.deletion_cancelled", entityType: "user", entityId: userId, ipHash });
  return true;
}

export const anonymisedEmail = (userId: string) => `deleted-${userId}@anonymised.townmart.invalid`;

/**
 * Removes everything that identifies the person. Keeps the user row (so
 * orders, reviews and the ledger still add up) with no name, email, phone,
 * password or sign-in methods. Returns the email it had, to confirm by.
 */
export async function anonymiseAccount(tx: Tx, userId: string, now = new Date()): Promise<{ email: string; name: string | null }> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, name: true } });
  // The address never gets marketing again, even from an old guest order.
  await tx.marketingSuppression.upsert({ where: { email: user.email }, create: { email: user.email, source: "account_deleted" }, update: {} });
  await tx.verificationToken.deleteMany({ where: { identifier: { endsWith: `:${user.email}` } } });
  await tx.account.deleteMany({ where: { userId } });
  await tx.session.deleteMany({ where: { userId } });
  await tx.address.deleteMany({ where: { userId } });
  await tx.cart.deleteMany({ where: { userId } });
  await tx.wishlistItem.deleteMany({ where: { userId } });
  await tx.notification.deleteMany({ where: { userId } });
  await tx.notificationPreference.deleteMany({ where: { userId } });
  await tx.otpCode.deleteMany({ where: { userId } });
  await tx.businessStaff.deleteMany({ where: { userId } });
  await tx.userRole.deleteMany({ where: { userId } });
  await tx.review.updateMany({ where: { userId }, data: { authorName: "Former customer" } });
  await tx.user.update({
    where: { id: userId },
    data: {
      email: anonymisedEmail(userId),
      emailVerified: null,
      name: null,
      image: null,
      phoneEncrypted: null,
      phoneHash: null,
      phoneVerifiedAt: null,
      passwordHash: null,
      twoFactorEnabledAt: null,
      failedLoginCount: 0,
      lockedUntil: null,
      status: "anonymised",
      anonymisedAt: now,
    },
  });
  await tx.dataSubjectRequest.updateMany({
    where: { userId, type: "erasure", status: { in: ["open", "in_progress"] } },
    data: { status: "completed", completedAt: now, resolutionNote: "Account anonymised after the grace period. Order and payment records kept as the law requires." },
  });
  await writeAudit(tx, { actorUserId: null, action: "account.anonymised", entityType: "user", entityId: userId });
  return user;
}
