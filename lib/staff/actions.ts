"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError } from "@/lib/authz";
import { randomToken, sha256 } from "@/lib/crypto";
import { withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { sellerSelect, tellSeller } from "@/lib/fulfilment/notify";
import { logger } from "@/lib/logger";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { acceptInvitationSchema, invitationIdSchema, inviteStaffSchema, staffIdSchema, staffPermissionsSchema } from "@/lib/validation/staff";
import { cleanFlags, INVITE_DAYS, STAFF_FLAGS } from "./flags";

/**
 * Store staff: the owner invites people by email, chooses what each can do,
 * and can change or remove them. The invitee accepts from the emailed link
 * while signed in with that email. One account works for one store.
 */

class StaffError extends Error {}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof StaffError) return { ok: false, error: err.message };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, error: "There's already a pending invitation for that email." };
  logger.error({ err }, "staff action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function owner(): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, "staff.manage", { businessId: ctx.business.id });
  return ctx;
}

const describe = (flags: Record<string, unknown>) =>
  STAFF_FLAGS.filter((f) => flags[f.key])
    .map((f) => f.label.toLowerCase())
    .join(", ");

function sendInvite(to: string, businessName: string, flags: Record<string, unknown>, token: string) {
  return enqueueEmail(
    noticeTemplate({
      to,
      subject: `Join ${businessName} on TownMart`,
      title: `You're invited to help run ${businessName}`,
      lines: [
        `${businessName} would like you to join their store on TownMart as staff, working on: ${describe(flags)}.`,
        `Sign in or create a TownMart account with this email address, then accept. The link works for ${INVITE_DAYS} days.`,
        "If you weren't expecting this, you can ignore it.",
      ],
      url: `${env().APP_URL}/invite/${token}`,
      buttonLabel: "See the invitation",
    }),
  );
}

export async function inviteStaffAction(input: z.input<typeof inviteStaffSchema>): Promise<ActionResult> {
  const parsed = inviteStaffSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { email } = parsed.data;
  const permissions = cleanFlags(parsed.data.permissions);
  try {
    const ctx = await owner();
    if (email === ctx.user.email.toLowerCase()) throw new StaffError("That's your own email. You already have full access.");
    if (!(await rateLimit(`staff-invite:${ctx.business.id}`, 20, 86_400)).allowed) throw new StaffError("You've sent a lot of invitations today. Please try again tomorrow.");
    const token = randomToken(32);
    await withSellerRls(ctx, async (tx) => {
      const already = await tx.businessStaff.count({ where: { businessId: ctx.business.id, user: { email } } });
      if (already) throw new StaffError("They're already on your team.");
      const inv = await tx.staffInvitation.create({
        data: { businessId: ctx.business.id, email, permissions, tokenHash: sha256(token), invitedBy: ctx.user.id, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) },
        select: { id: true },
      });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "staff.invited", entityType: "staff_invitation", entityId: inv.id, after: { email, permissions } });
    });
    await sendInvite(email, ctx.business.name, permissions, token);
    revalidatePath("/dashboard/staff");
    return { ok: true, message: `Invitation sent to ${email}.` };
  } catch (err) {
    return failure(err);
  }
}

/** A fresh link (the old one stops working) and another week. */
export async function resendInvitationAction(input: z.input<typeof invitationIdSchema>): Promise<ActionResult> {
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await owner();
    if (!(await rateLimit(`staff-invite:${ctx.business.id}`, 20, 86_400)).allowed) throw new StaffError("You've sent a lot of invitations today. Please try again tomorrow.");
    const token = randomToken(32);
    const inv = await withSellerRls(ctx, async (tx) => {
      const inv = await tx.staffInvitation.findFirst({ where: { id: parsed.data.invitationId, businessId: ctx.business.id, acceptedAt: null, revokedAt: null }, select: { id: true, email: true, permissions: true } });
      if (!inv) throw new StaffError("That invitation has been accepted or cancelled.");
      await tx.staffInvitation.update({ where: { id: inv.id }, data: { tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "staff.invitation_resent", entityType: "staff_invitation", entityId: inv.id });
      return inv;
    });
    await sendInvite(inv.email, ctx.business.name, inv.permissions as Record<string, unknown>, token);
    revalidatePath("/dashboard/staff");
    return { ok: true, message: `Sent again to ${inv.email}.` };
  } catch (err) {
    return failure(err);
  }
}

export async function revokeInvitationAction(input: z.input<typeof invitationIdSchema>): Promise<ActionResult> {
  const parsed = invitationIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await owner();
    await withSellerRls(ctx, async (tx) => {
      const { count } = await tx.staffInvitation.updateMany({ where: { id: parsed.data.invitationId, businessId: ctx.business.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!count) throw new StaffError("That invitation has already been accepted or cancelled.");
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "staff.invitation_revoked", entityType: "staff_invitation", entityId: parsed.data.invitationId });
    });
    revalidatePath("/dashboard/staff");
    return { ok: true, message: "Invitation cancelled. The link no longer works." };
  } catch (err) {
    return failure(err);
  }
}

export async function updateStaffPermissionsAction(input: z.input<typeof staffPermissionsSchema>): Promise<ActionResult> {
  const parsed = staffPermissionsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const permissions = cleanFlags(parsed.data.permissions);
  try {
    const ctx = await owner();
    await withSellerRls(ctx, async (tx) => {
      const s = await tx.businessStaff.findFirst({ where: { id: parsed.data.staffId, businessId: ctx.business.id }, select: { id: true, permissions: true } });
      if (!s) throw new StaffError("They're no longer on your team.");
      await tx.businessStaff.update({ where: { id: s.id }, data: { permissions } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "staff.permissions_updated", entityType: "business_staff", entityId: s.id, before: s.permissions, after: permissions });
    });
    revalidatePath("/dashboard/staff");
    return { ok: true, message: "Saved. The change applies straight away." };
  } catch (err) {
    return failure(err);
  }
}

export async function removeStaffAction(input: z.input<typeof staffIdSchema>): Promise<ActionResult> {
  const parsed = staffIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await owner();
    const userId = await withSellerRls(ctx, async (tx) => {
      const s = await tx.businessStaff.findFirst({ where: { id: parsed.data.staffId, businessId: ctx.business.id }, select: { id: true, userId: true } });
      if (!s) throw new StaffError("They're no longer on your team.");
      await tx.businessStaff.delete({ where: { id: s.id } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "staff.removed", entityType: "business_staff", entityId: s.id, after: { userId: s.userId } });
      return s.userId;
    });
    // The staff role is TownMart's to change (RLS): drop it once they work for no store.
    await withSystemContext(async (tx) => {
      if ((await tx.businessStaff.count({ where: { userId } })) === 0) await tx.userRole.deleteMany({ where: { userId, role: "staff" } });
    });
    revalidatePath("/dashboard/staff");
    return { ok: true, message: "Removed. They can't open your dashboard any more." };
  } catch (err) {
    return failure(err);
  }
}

/** The invitee accepts while signed in with the invited email. Runs as TownMart: the invitee has no store context yet. */
export async function acceptInvitationAction(input: z.input<typeof acceptInvitationSchema>): Promise<ActionResult> {
  const parsed = acceptInvitationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This invitation link isn't valid." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in first." };
  try {
    const res = await withSystemContext(async (tx) => {
      const inv = await tx.staffInvitation.findUnique({ where: { tokenHash: sha256(parsed.data.token) }, include: { business: { select: { ...sellerSelect, status: true } } } });
      if (!inv || inv.revokedAt) throw new StaffError("This invitation has been cancelled. Ask the store for a new one.");
      if (inv.acceptedAt) throw new StaffError("This invitation has already been used.");
      if (inv.expiresAt <= new Date()) throw new StaffError("This invitation has expired. Ask the store to send it again.");
      if (inv.email.toLowerCase() !== user.email.toLowerCase()) throw new StaffError(`This invitation is for ${inv.email}. Sign in with that email to accept it.`);
      if (inv.business.status === "suspended") throw new StaffError("This store isn't active on TownMart right now.");
      if (await tx.business.count({ where: { ownerUserId: user.id } })) throw new StaffError("You own a store on TownMart, so this account can't also work for another one. Use a different account.");
      if (await tx.businessStaff.count({ where: { userId: user.id } })) throw new StaffError("You already work for a store on TownMart. Ask them to remove you first.");
      const staff = await tx.businessStaff.create({ data: { businessId: inv.businessId, userId: user.id, permissions: inv.permissions as Prisma.InputJsonValue, invitedAt: inv.createdAt, acceptedAt: new Date() }, select: { id: true } });
      await tx.staffInvitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date(), acceptedUserId: user.id } });
      await tx.userRole.upsert({ where: { userId_role: { userId: user.id, role: "staff" } }, create: { userId: user.id, role: "staff", grantedBy: inv.invitedBy }, update: {} });
      // Possession of the emailed link proves the address.
      await tx.user.updateMany({ where: { id: user.id, emailVerified: null }, data: { emailVerified: new Date() } });
      await writeAudit(tx, { actorUserId: user.id, action: "staff.joined", entityType: "business_staff", entityId: staff.id, after: { businessId: inv.businessId, invitationId: inv.id } });
      await tellSeller(tx, inv.business, { type: "staff.joined", title: `${user.name ?? user.email} joined your team`, lines: [`${user.name ?? user.email} accepted your invitation and can now work on: ${describe(inv.permissions as Record<string, unknown>)}.`], path: "/dashboard/staff" });
      return inv.business.name;
    });
    revalidatePath("/dashboard", "layout");
    return { ok: true, message: `You've joined ${res}. Opening your dashboard…` };
  } catch (err) {
    return failure(err);
  }
}
