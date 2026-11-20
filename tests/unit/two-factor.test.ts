import { describe, expect, it } from "vitest";
import { generateBackupCodes, looksLikeBackupCode, normaliseBackupCode } from "@/lib/auth/backup-codes";
import { base32Decode, base32Encode, generateTotpSecret, otpauthUrl, totpCode, totpStep, verifyTotp } from "@/lib/auth/totp";
import { businessDetailsSchema } from "@/lib/validation/seller";

// RFC 6238 appendix B test secret ("12345678901234567890") and SHA-1 vectors, last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
const RFC_VECTORS: [number, string][] = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("authenticator app codes (TOTP)", () => {
  it("matches the RFC 6238 test vectors", () => {
    for (const [seconds, code] of RFC_VECTORS) expect(totpCode(RFC_SECRET, totpStep(seconds * 1000))).toBe(code);
  });

  it("round-trips base32", () => {
    const bytes = Buffer.from("TownMart secret!");
    expect(base32Decode(base32Encode(bytes)).equals(bytes)).toBe(true);
    expect(base32Decode("gezd gnbv-gy3t qojq")).toEqual(base32Decode("GEZDGNBVGY3TQOJQ"));
  });

  it("makes 160-bit secrets", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(s);
  });

  it("accepts the step either side for clock drift, and no further", () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, totpCode(secret, step), { now })).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), { now })).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), { now })).toBeNull();
    expect(verifyTotp(secret, "12345", { now })).toBeNull();
    expect(verifyTotp(secret, "abcdef", { now })).toBeNull();
  });

  it("refuses a code from a step already used", () => {
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    const secret = generateTotpSecret();
    const code = totpCode(secret, step);
    expect(verifyTotp(secret, code, { now, lastStep: step })).toBeNull();
    expect(verifyTotp(secret, code, { now, lastStep: step - 1 })).toBe(step);
  });

  it("builds an otpauth link apps can read", () => {
    const url = new URL(otpauthUrl({ secret: "JBSWY3DPEHPK3PXP", account: "bola@example.com" }));
    expect(url.protocol).toBe("otpauth:");
    expect(url.href.startsWith("otpauth://totp/TownMart%3Abola%40example.com?")).toBe(true);
    expect(url.searchParams.get("secret")).toBe("JBSWY3DPEHPK3PXP");
    expect(url.searchParams.get("issuer")).toBe("TownMart");
  });
});

describe("backup codes", () => {
  it("makes ten distinct, readable codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
      expect(c).not.toMatch(/[01oil]/);
      expect(looksLikeBackupCode(c)).toBe(true);
    }
  });

  it("ignores case, spaces and dashes", () => {
    expect(normaliseBackupCode(" K7M4 X9QP ")).toBe("k7m4x9qp");
    expect(normaliseBackupCode("k7m4-x9qp")).toBe("k7m4x9qp");
    expect(looksLikeBackupCode("123456")).toBe(false);
  });
});

describe("seller sign-up", () => {
  const base = {
    name: "Mama Put Kitchen",
    slug: "mama-put",
    email: "hello@mamaput.ng",
    phone: "08031234567",
    addressLine: "12 Ogunlana Street",
    city: "Mowe",
    stateId: 1,
    lgaId: 1,
    sellsProducts: true,
    sellsServices: false,
  };

  it("doesn't need a CAC number for any business type", () => {
    for (const type of ["retailer", "supermarket", "vendor", "merchant", "producer", "service_provider", "artisan"] as const) {
      expect(businessDetailsSchema.safeParse({ ...base, type, cacNumber: "" }).success).toBe(true);
      expect(businessDetailsSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });

  it("still checks the format when one is given", () => {
    expect(businessDetailsSchema.safeParse({ ...base, type: "retailer", cacNumber: "RC 1234567" }).success).toBe(true);
    expect(businessDetailsSchema.safeParse({ ...base, type: "retailer", cacNumber: "not-a-number" }).success).toBe(false);
  });
});
