import type { Role } from "@prisma/client";

/**
 * Central authorisation policy. Every Server Action and route handler calls
 * `can`/`assertCan` before touching the database; RLS (lib/db/rls.ts) is the
 * second layer.
 *
 * Permissions come in two kinds:
 *  - global: granted purely by role (e.g. `admin.access`)
 *  - owned:  granted by role AND ownership of the resource (e.g. `address.read`).
 *            Roles holding the matching `:any` permission skip the ownership check.
 */

export type Actor = { id: string; roles: readonly Role[] } | null;

type OwnedResources = {
  "address.read": { userId: string };
  "address.write": { userId: string };
  "session.revoke": { userId: string };
};

type OwnedPermission = keyof OwnedResources;

type GlobalPermission =
  | "account.access"
  | "dashboard.access"
  | "admin.access"
  | "design_system.view"
  | "audit_log.read"
  | "settings.manage"
  | "user.roles.manage"
  | "system_health.view";

type AnyPermission = `${OwnedPermission}:any`;

export type Permission = GlobalPermission | OwnedPermission;
type Grant = Permission | AnyPermission;

const SELLER_BASE: Grant[] = ["account.access", "dashboard.access", "address.read", "address.write", "session.revoke"];

const ADMIN: Grant[] = [
  "account.access",
  "admin.access",
  "design_system.view",
  "system_health.view",
  "settings.manage",
  "address.read",
  "address.write",
  "session.revoke",
  "address.read:any",
  "session.revoke:any",
];

export const ROLE_GRANTS: Record<Role, readonly Grant[]> = {
  customer: ["account.access", "address.read", "address.write", "session.revoke"],
  merchant: SELLER_BASE,
  service_provider: SELLER_BASE,
  staff: SELLER_BASE,
  admin: ADMIN,
  super_admin: [...ADMIN, "audit_log.read", "user.roles.manage", "address.write:any"],
};

const OWNED: ReadonlySet<string> = new Set<OwnedPermission>(["address.read", "address.write", "session.revoke"]);

function hasGrant(actor: NonNullable<Actor>, grant: Grant): boolean {
  return actor.roles.some((role) => ROLE_GRANTS[role].includes(grant));
}

type ResourceArgs<P extends Permission> = P extends OwnedPermission ? [resource: OwnedResources[P]] : [];

export function can<P extends Permission>(actor: Actor, permission: P, ...args: ResourceArgs<P>): boolean {
  if (!actor) return false;
  if (!OWNED.has(permission)) return hasGrant(actor, permission);

  const resource = args[0] as { userId: string } | undefined;
  if (!resource) return false;
  if (hasGrant(actor, `${permission as OwnedPermission}:any`)) return true;
  return hasGrant(actor, permission) && resource.userId === actor.id;
}

export class AuthzError extends Error {
  readonly status: 401 | 403;
  constructor(status: 401 | 403, message = status === 401 ? "Sign in required" : "Not allowed") {
    super(message);
    this.name = "AuthzError";
    this.status = status;
  }
}

/** Throws AuthzError (401 when signed out, 403 when not permitted). */
export function assertCan<P extends Permission>(actor: Actor, permission: P, ...args: ResourceArgs<P>): asserts actor is NonNullable<Actor> {
  if (!actor) throw new AuthzError(401);
  if (!can(actor, permission, ...args)) throw new AuthzError(403);
}

export const isPlatformAdmin = (actor: Actor) => !!actor && actor.roles.some((r) => r === "admin" || r === "super_admin");

/** The RLS scope to use after an authz check: admins act with `admin` scope only inside the admin console. */
export function rlsScopeFor(actor: NonNullable<Actor>, area: "storefront" | "admin"): "user" | "admin" {
  return area === "admin" && isPlatformAdmin(actor) ? "admin" : "user";
}
