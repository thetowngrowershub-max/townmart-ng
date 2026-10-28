"use server";

import type { Role } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext, AdminError, adminFailure } from "@/lib/admin/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

/**
 * Account administration: suspend and restore accounts, sign someone out
 * everywhere, and (super admins only) grant or remove TownMart staff roles.
 * Seller roles follow businesses, so they aren't edited here.
 */

const fail = (err: unknown) => adminFailure(err, "user admin action");

/** Roles the console can grant. Merchant, provider and staff roles come from businesses. */
export type ConsoleRole = Extract<Role, "admin" | "super_admin">;

const suspendSchema = z.object({ userId: z.uuid(), reason: z.string().trim().min(5, "Say why, for the audit log").max(500) });
const userIdSchema = z.object({ userId: z.uuid() });
const roleSchema = z.object({ userId: z.uuid(), role: z.enum(["admin", "super_admin"]), grant: z.boolean() });

function refresh(userId: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function suspendUserAction(input: z.input<typeof suspendSchema>): Promise<ActionResult> {
  const parsed = suspendSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { userId, reason } = parsed.data;
  try {
    const { actor, run } = await adminContext("user.manage");
    if (userId === actor.id) throw new AdminError("You can't suspend your own account.");
    await run(async (tx, audit) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { status: true, roles: { select: { role: true } } } });
      if (!u) throw new AdminError("Account not found.");
      if (u.status !== "active") throw new AdminError("Only active accounts can be suspended.");
      const roles = u.roles.map((r) => r.role);
      if ((roles.includes("admin") || roles.includes("super_admin")) && !actor.roles.includes("super_admin")) throw new AdminError("Only a super admin can suspend TownMart staff.");
      await tx.user.update({ where: { id: userId }, data: { status: "suspended" } });
      // Database sessions: deleting them signs the account out on every device at once.
      const { count } = await tx.session.deleteMany({ where: { userId } });
      await audit("user.suspended", "user", userId, { status: "suspended", reason, sessionsEnded: count }, { status: u.status });
    });
    refresh(userId);
    return { ok: true, message: "Account suspended and signed out everywhere." };
  } catch (err) {
    return fail(err);
  }
}

export async function restoreUserAction(input: z.input<typeof userIdSchema>): Promise<ActionResult> {
  const parsed = userIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { userId } = parsed.data;
  try {
    const { run } = await adminContext("user.manage");
    await run(async (tx, audit) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!u) throw new AdminError("Account not found.");
      if (u.status !== "suspended") throw new AdminError("Only suspended accounts can be restored.");
      await tx.user.update({ where: { id: userId }, data: { status: "active", failedLoginCount: 0, lockedUntil: null } });
      await audit("user.restored", "user", userId, { status: "active" }, { status: u.status });
    });
    refresh(userId);
    return { ok: true, message: "Account restored. They can sign in again." };
  } catch (err) {
    return fail(err);
  }
}

export async function signOutEverywhereAction(input: z.input<typeof userIdSchema>): Promise<ActionResult> {
  const parsed = userIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { userId } = parsed.data;
  try {
    const { run } = await adminContext("user.manage");
    const n = await run(async (tx, audit) => {
      const { count } = await tx.session.deleteMany({ where: { userId } });
      await audit("user.sessions_revoked", "user", userId, { sessionsEnded: count });
      return count;
    });
    refresh(userId);
    return { ok: true, message: n ? `Signed out of ${n} session${n === 1 ? "" : "s"}.` : "They weren't signed in anywhere." };
  } catch (err) {
    return fail(err);
  }
}

export async function setRoleAction(input: z.input<typeof roleSchema>): Promise<ActionResult> {
  const parsed = roleSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { userId, role, grant } = parsed.data;
  try {
    const { actor, run } = await adminContext("user.roles.manage");
    if (!grant && userId === actor.id && role === "super_admin") throw new AdminError("You can't remove your own super admin role. Ask another super admin.");
    await run(async (tx, audit) => {
      const u = await tx.user.findUnique({ where: { id: userId }, select: { status: true, emailVerified: true, roles: { select: { role: true } } } });
      if (!u) throw new AdminError("Account not found.");
      const has = u.roles.some((r) => r.role === role);
      if (grant) {
        if (has) throw new AdminError("They already have that role.");
        if (u.status !== "active") throw new AdminError("Only active accounts can be given a staff role.");
        if (!u.emailVerified) throw new AdminError("They need to verify their email first.");
        await tx.userRole.create({ data: { userId, role, grantedBy: actor.id } });
      } else {
        if (!has) throw new AdminError("They don't have that role.");
        if (role === "super_admin" && (await tx.userRole.count({ where: { role: "super_admin", user: { status: "active" } } })) <= 1) {
          throw new AdminError("TownMart needs at least one super admin.");
        }
        await tx.userRole.deleteMany({ where: { userId, role } });
      }
      await audit(grant ? "user.role_granted" : "user.role_removed", "user", userId, { role }, { roles: u.roles.map((r) => r.role) });
      // A role change takes effect on their next request; ending sessions makes a removal immediate and visible.
      if (!grant) await tx.session.deleteMany({ where: { userId } });
    });
    refresh(userId);
    return { ok: true, message: grant ? `Role “${role.replace("_", " ")}” granted.` : `Role “${role.replace("_", " ")}” removed. They've been signed out.` };
  } catch (err) {
    return fail(err);
  }
}
