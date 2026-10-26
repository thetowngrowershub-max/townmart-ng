import type { Role } from "@prisma/client";

/**
 * Central authorisation policy. Every Server Action and route handler calls
 * `can`/`assertCan` before touching the database; RLS (lib/db/rls.ts) is the
 * second layer.
 *
 * Permissions come in three kinds:
 *  - global:   granted purely by role (e.g. `admin.access`)
 *  - owned:    granted by role AND ownership of the resource (e.g. `address.read`).
 *              Roles holding the matching `:any` grant skip the ownership check.
 *  - business: granted by membership of the seller business that owns the
 *              resource (owner, or staff with the right permission flag).
 */

export type BusinessMembership = {
  id: string;
  role: "owner" | "staff";
  /** Staff permission flags, e.g. { inventory: true } */
  permissions?: Readonly<Record<string, boolean>>;
};

export type Actor = { id: string; roles: readonly Role[]; businesses?: readonly BusinessMembership[] } | null;

type OwnedResources = {
  "address.read": { userId: string };
  "address.write": { userId: string };
  "session.revoke": { userId: string };
};
type OwnedPermission = keyof OwnedResources;

type BusinessPermission = "listing.read" | "listing.write" | "import.manage" | "store.manage";

export type GlobalPermission =
  | "account.access"
  | "dashboard.access"
  | "admin.access"
  | "design_system.view"
  | "audit_log.read"
  | "settings.manage"
  | "user.roles.manage"
  | "system_health.view"
  | "seller.onboard"
  | "seller.review"
  | "kyc.document.view";

type AnyPermission = `${OwnedPermission | BusinessPermission}:any`;

export type Permission = GlobalPermission | OwnedPermission | BusinessPermission;
type Grant = GlobalPermission | OwnedPermission | AnyPermission;

const CUSTOMER: Grant[] = ["account.access", "address.read", "address.write", "session.revoke", "seller.onboard"];
const SELLER_BASE: Grant[] = [...CUSTOMER, "dashboard.access"];

const ADMIN: Grant[] = [
  "account.access",
  "admin.access",
  "design_system.view",
  "system_health.view",
  "settings.manage",
  "seller.review",
  "kyc.document.view",
  "address.read",
  "address.write",
  "session.revoke",
  "address.read:any",
  "session.revoke:any",
  "listing.read:any",
];

export const ROLE_GRANTS: Record<Role, readonly Grant[]> = {
  customer: CUSTOMER,
  merchant: SELLER_BASE,
  service_provider: SELLER_BASE,
  staff: SELLER_BASE,
  admin: ADMIN,
  super_admin: [...ADMIN, "audit_log.read", "user.roles.manage", "address.write:any"],
};

const OWNED: ReadonlySet<string> = new Set<OwnedPermission>(["address.read", "address.write", "session.revoke"]);
const BUSINESS: ReadonlySet<string> = new Set<BusinessPermission>(["listing.read", "listing.write", "import.manage", "store.manage"]);

/** Which staff permission flag unlocks each business permission. `null` = owner only. */
const STAFF_FLAG: Record<BusinessPermission, string | null> = {
  "listing.read": "inventory",
  "listing.write": "inventory",
  "import.manage": "inventory",
  "store.manage": null,
};

function hasGrant(actor: NonNullable<Actor>, grant: Grant): boolean {
  return actor.roles.some((role) => ROLE_GRANTS[role].includes(grant));
}

type ResourceArgs<P extends Permission> = P extends OwnedPermission
  ? [resource: OwnedResources[P]]
  : P extends BusinessPermission
    ? [resource: { businessId: string }]
    : [];

export function can<P extends Permission>(actor: Actor, permission: P, ...args: ResourceArgs<P>): boolean {
  if (!actor) return false;
  const resource = args[0] as { userId?: string; businessId?: string } | undefined;

  if (OWNED.has(permission)) {
    if (!resource?.userId) return false;
    if (hasGrant(actor, `${permission as OwnedPermission}:any`)) return true;
    return hasGrant(actor, permission as OwnedPermission) && resource.userId === actor.id;
  }

  if (BUSINESS.has(permission)) {
    if (!resource?.businessId) return false;
    if (hasGrant(actor, `${permission as BusinessPermission}:any`)) return true;
    const membership = actor.businesses?.find((b) => b.id === resource.businessId);
    if (!membership) return false;
    if (membership.role === "owner") return true;
    const flag = STAFF_FLAG[permission as BusinessPermission];
    return flag !== null && membership.permissions?.[flag] === true;
  }

  return hasGrant(actor, permission as GlobalPermission);
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
