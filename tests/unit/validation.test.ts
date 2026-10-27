import { describe, expect, it } from "vitest";
import { redact } from "@/lib/audit";
import { slugify } from "@/lib/slug";
import { resetPasswordSchema, safeNextPath, signUpSchema } from "@/lib/validation/auth";

describe("safeNextPath", () => {
  it.each([
    ["/account", "/account"],
    ["/dashboard?tab=orders", "/dashboard?tab=orders"],
    ["//evil.example", undefined],
    ["/\\evil.example", undefined],
    ["https://evil.example", undefined],
    [undefined, undefined],
  ])("%j → %j", (input, expected) => {
    expect(safeNextPath.parse(input)).toBe(expected);
  });
});

describe("signUpSchema", () => {
  it("normalises email and enforces password length", () => {
    const ok = signUpSchema.parse({ name: " Ada Obi ", email: " Ada@Example.COM ", password: "long-enough-pw", acceptTerms: true });
    expect(ok.email).toBe("ada@example.com");
    expect(ok.name).toBe("Ada Obi");
    expect(ok.marketingEmail).toBe(false);
    expect(signUpSchema.safeParse({ name: "Ada", email: "ada@example.com", password: "short", acceptTerms: true }).success).toBe(false);
  });

  it("needs the terms accepted; offers stay a separate, optional choice", () => {
    expect(signUpSchema.safeParse({ name: "Ada", email: "ada@example.com", password: "long-enough-pw" }).success).toBe(false);
    expect(signUpSchema.safeParse({ name: "Ada", email: "ada@example.com", password: "long-enough-pw", acceptTerms: false }).success).toBe(false);
    expect(signUpSchema.parse({ name: "Ada", email: "ada@example.com", password: "long-enough-pw", acceptTerms: true, marketingEmail: true }).marketingEmail).toBe(true);
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const base = { email: "a@b.co", token: "x".repeat(43), password: "long-enough-pw" };
    expect(resetPasswordSchema.safeParse({ ...base, confirmPassword: "long-enough-pw" }).success).toBe(true);
    const bad = resetPasswordSchema.safeParse({ ...base, confirmPassword: "different-pw" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("audit redaction", () => {
  it("removes secrets and personal data at any depth", () => {
    expect(
      redact({ name: "Ada", passwordHash: "x", nested: { phone_encrypted: "y", items: [{ token: "z", qty: 2 }] }, amount: 500n }),
    ).toEqual({ name: "Ada", passwordHash: "[redacted]", nested: { phone_encrypted: "[redacted]", items: [{ token: "[redacted]", qty: 2 }] }, amount: "500" });
  });
});

describe("slugify", () => {
  it.each([
    ["Ado-Odo/Ota", "ado-odo-ota"],
    ["FCT Abuja", "fct-abuja"],
    ["Fruits & Vegetables", "fruits-and-vegetables"],
    ["  Ìbàdàn North ", "ibadan-north"],
  ])("%s → %s", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});
