import { afterEach, describe, expect, it, vi } from "vitest";

async function freshCrypto() {
  vi.resetModules();
  return import("@/lib/crypto");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("column encryption", () => {
  it("round-trips and never produces the same ciphertext twice", async () => {
    const { encrypt, decrypt } = await freshCrypto();
    const a = encrypt("+2348031234567");
    const b = encrypt("+2348031234567");
    expect(a).not.toBe(b);
    expect(a).not.toContain("2348031234567");
    expect(decrypt(a)).toBe("+2348031234567");
    expect(decrypt(b)).toBe("+2348031234567");
  });

  it("rejects tampered ciphertext", async () => {
    const { encrypt, decrypt } = await freshCrypto();
    const parts = encrypt("12 Allen Avenue, Ikeja").split(".");
    const data = Buffer.from(parts[4]!, "base64url");
    data[0] = data[0]! ^ 0xff;
    parts[4] = data.toString("base64url");
    expect(() => decrypt(parts.join("."))).toThrow();
  });

  it("decrypts data written with a previous key after rotation", async () => {
    const oldKey = Buffer.alloc(32, 7).toString("base64");
    vi.stubEnv("DATA_ENCRYPTION_KEY", oldKey);
    vi.stubEnv("DATA_ENCRYPTION_KEY_ID", "k1");
    const before = await freshCrypto();
    const ciphertext = before.encrypt("secret");
    expect(ciphertext.split(".")[1]).toBe("k1");

    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("DATA_ENCRYPTION_KEY_ID", "k2");
    vi.stubEnv("DATA_ENCRYPTION_KEY_k1", oldKey);
    const after = await freshCrypto();
    expect(after.decrypt(ciphertext)).toBe("secret");
    expect(after.encrypt("secret").split(".")[1]).toBe("k2");
  });

  it("handles nullable helpers", async () => {
    const { encryptNullable, decryptNullable } = await freshCrypto();
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable("")).toBeNull();
    expect(decryptNullable(encryptNullable("x"))).toBe("x");
  });
});

describe("lookup hashes", () => {
  it("are deterministic and purpose-separated", async () => {
    const { lookupHash, phoneHash, ipHash } = await freshCrypto();
    expect(phoneHash("+2348031234567")).toBe(phoneHash("+2348031234567"));
    expect(lookupHash("x", "phone")).not.toBe(lookupHash("x", "ip"));
    expect(ipHash("1.2.3.4")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("normaliseNigerianPhone", () => {
  it.each([
    ["08031234567", "+2348031234567"],
    ["0803 123 4567", "+2348031234567"],
    ["+234 803 123 4567", "+2348031234567"],
    ["2349061234567", "+2349061234567"],
    ["07011234567", "+2347011234567"],
  ])("%s → %s", async (input, expected) => {
    const { normaliseNigerianPhone } = await freshCrypto();
    expect(normaliseNigerianPhone(input)).toBe(expected);
  });

  it.each(["12345", "0603123456", "+1 415 555 0100", ""])("rejects %j", async (input) => {
    const { normaliseNigerianPhone } = await freshCrypto();
    expect(normaliseNigerianPhone(input)).toBeNull();
  });
});
