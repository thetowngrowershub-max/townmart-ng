import "server-only";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError, type GlobalPermission } from "@/lib/authz";
import { withRls, type Tx } from "@/lib/db";
import { logger } from "@/lib/logger";
import { requestMeta } from "@/lib/request";
import type { ActionResult } from "@/lib/validation/form-result";

/**
 * Shared plumbing for admin console writes: the permission check, then a
 * transaction in admin scope (privileged under RLS) with an audit writer
 * bound to the acting admin.
 */

/** A refusal whose message is safe to show the admin. */
export class AdminError extends Error {}

export type Audit = (action: string, entityType: string, entityId: string | null, after?: unknown, before?: unknown) => Promise<void>;

export async function adminContext(permission: GlobalPermission) {
  const actor = await getCurrentUser();
  assertCan(actor, permission);
  const meta = await requestMeta();
  const role = actor.roles.includes("super_admin") ? "super_admin" : "admin";
  const run = <T,>(fn: (tx: Tx, audit: Audit) => Promise<T>) =>
    withRls({ scope: "admin", userId: actor.id }, (tx) =>
      fn(tx, (action, entityType, entityId, after, before) => writeAudit(tx, { actorUserId: actor.id, actorRole: role, action, entityType, entityId, after, before, ipHash: meta.ipHash })),
    );
  return { actor, meta, run };
}

export function adminFailure(err: unknown, what: string): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof AdminError) return { ok: false, error: err.message };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, error: "That already exists." };
  logger.error({ err }, `${what} failed`);
  return { ok: false, error: "Something went wrong. Please try again." };
}
