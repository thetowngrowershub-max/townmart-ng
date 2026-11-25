import { describe, expect, it } from "vitest";
import { can, type Actor } from "@/lib/authz";

const A = "biz-a";
const B = "biz-b";
const owner: Actor = { id: "u-owner", roles: ["merchant"], businesses: [{ id: A, role: "owner" }] };
const stockKeeper: Actor = { id: "u-staff", roles: ["staff"], businesses: [{ id: A, role: "staff", permissions: { inventory: true } }] };
const cashier: Actor = { id: "u-cashier", roles: ["staff"], businesses: [{ id: A, role: "staff", permissions: { orders: true } }] };
const admin: Actor = { id: "u-admin", roles: ["admin"] };

describe("can — business permissions", () => {
  it("gives owners every permission on their own business only", () => {
    for (const p of ["listing.read", "listing.write", "import.manage", "store.manage", "promotion.manage"] as const) {
      expect(can(owner, p, { businessId: A })).toBe(true);
      expect(can(owner, p, { businessId: B })).toBe(false);
    }
  });

  it("lets staff with the inventory flag manage listings but not store settings", () => {
    expect(can(stockKeeper, "listing.write", { businessId: A })).toBe(true);
    expect(can(stockKeeper, "import.manage", { businessId: A })).toBe(true);
    expect(can(stockKeeper, "store.manage", { businessId: A })).toBe(false);
    expect(can(stockKeeper, "listing.read", { businessId: B })).toBe(false);
  });

  it("keeps promotions to staff with the promotions flag", () => {
    const marketer: Actor = { id: "u-mkt", roles: ["staff"], businesses: [{ id: A, role: "staff", permissions: { promotions: true } }] };
    expect(can(marketer, "promotion.manage", { businessId: A })).toBe(true);
    expect(can(marketer, "listing.write", { businessId: A })).toBe(false);
    expect(can(stockKeeper, "promotion.manage", { businessId: A })).toBe(false);
    expect(can(admin, "promotion.manage", { businessId: A })).toBe(false);
  });

  it("denies listing access to staff without the inventory flag", () => {
    expect(can(cashier, "listing.read", { businessId: A })).toBe(false);
    expect(can(cashier, "listing.write", { businessId: A })).toBe(false);
  });

  it("lets admins read any seller's listings but not edit them", () => {
    expect(can(admin, "listing.read", { businessId: B })).toBe(true);
    expect(can(admin, "listing.write", { businessId: B })).toBe(false);
    expect(can(admin, "store.manage", { businessId: B })).toBe(false);
  });

  it("keeps seller review and KYC documents for admins", () => {
    expect(can(admin, "seller.review")).toBe(true);
    expect(can(admin, "kyc.document.view")).toBe(true);
    expect(can(owner, "seller.review")).toBe(false);
    expect(can(owner, "kyc.document.view")).toBe(false);
    expect(can({ id: "c", roles: ["customer"] }, "seller.onboard")).toBe(true);
  });

  it("denies guests and empty business ids", () => {
    expect(can(null, "listing.read", { businessId: A })).toBe(false);
    expect(can(owner, "listing.read", { businessId: "" })).toBe(false);
  });
});
