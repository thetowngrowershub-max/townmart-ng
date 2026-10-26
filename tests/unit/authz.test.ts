import { describe, expect, it } from "vitest";
import { assertCan, AuthzError, can, isPlatformAdmin, rlsScopeFor, type Actor } from "@/lib/authz";

const customer: Actor = { id: "u-customer", roles: ["customer"] };
const merchant: Actor = { id: "u-merchant", roles: ["customer", "merchant"] };
const admin: Actor = { id: "u-admin", roles: ["admin"] };
const superAdmin: Actor = { id: "u-super", roles: ["super_admin"] };

describe("can — global permissions", () => {
  it("denies everything to guests", () => {
    expect(can(null, "account.access")).toBe(false);
    expect(can(null, "admin.access")).toBe(false);
  });

  it("lets customers into their account but not the seller dashboard or admin", () => {
    expect(can(customer, "account.access")).toBe(true);
    expect(can(customer, "dashboard.access")).toBe(false);
    expect(can(customer, "admin.access")).toBe(false);
  });

  it("lets sellers into the dashboard", () => {
    expect(can(merchant, "dashboard.access")).toBe(true);
    expect(can({ id: "x", roles: ["service_provider"] }, "dashboard.access")).toBe(true);
    expect(can({ id: "x", roles: ["staff"] }, "dashboard.access")).toBe(true);
  });

  it("keeps audit log and role management for super admins", () => {
    expect(can(admin, "admin.access")).toBe(true);
    expect(can(admin, "design_system.view")).toBe(true);
    expect(can(admin, "audit_log.read")).toBe(false);
    expect(can(admin, "user.roles.manage")).toBe(false);
    expect(can(superAdmin, "audit_log.read")).toBe(true);
    expect(can(superAdmin, "user.roles.manage")).toBe(true);
  });
});

describe("can — owned resources", () => {
  it("allows owners and denies other users", () => {
    expect(can(customer, "address.read", { userId: "u-customer" })).toBe(true);
    expect(can(customer, "address.read", { userId: "someone-else" })).toBe(false);
    expect(can(merchant, "address.write", { userId: "u-customer" })).toBe(false);
  });

  it("lets admins read any address but only super admins write any", () => {
    expect(can(admin, "address.read", { userId: "u-customer" })).toBe(true);
    expect(can(admin, "address.write", { userId: "u-customer" })).toBe(false);
    expect(can(superAdmin, "address.write", { userId: "u-customer" })).toBe(true);
  });

  it("denies when the resource is missing", () => {
    // @ts-expect-error — resource is required for owned permissions
    expect(can(customer, "address.read")).toBe(false);
  });
});

describe("assertCan", () => {
  it("throws 401 for guests and 403 for the wrong role", () => {
    expect(() => assertCan(null, "account.access")).toThrow(expect.objectContaining({ status: 401 }));
    try {
      assertCan(customer, "admin.access");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AuthzError);
      expect((err as AuthzError).status).toBe(403);
    }
  });

  it("passes silently when allowed", () => {
    expect(() => assertCan(customer, "session.revoke", { userId: "u-customer" })).not.toThrow();
  });
});

describe("helpers", () => {
  it("identifies platform admins and picks the RLS scope", () => {
    expect(isPlatformAdmin(admin)).toBe(true);
    expect(isPlatformAdmin(merchant)).toBe(false);
    expect(rlsScopeFor(admin!, "admin")).toBe("admin");
    expect(rlsScopeFor(admin!, "storefront")).toBe("user");
    expect(rlsScopeFor(merchant!, "admin")).toBe("user");
  });
});
