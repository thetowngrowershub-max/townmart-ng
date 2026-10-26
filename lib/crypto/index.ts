import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Column-level encryption for personal data (phone numbers, addresses, KYC refs).
 *
 * Format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url parts), AES-256-GCM.
 * The key id lets us rotate keys: decrypt looks up the key by id, encrypt always
 * uses the current key. See scripts/db/rotate-keys.md.
 */

const VERSION = "v1";
const IV_BYTES = 12;

type Keyring = { currentId: string; keys: Map<string, Buffer> };

function keyring(): Keyring {
  const e = env();
  const keys = new Map<string, Buffer>([[e.DATA_ENCRYPTION_KEY_ID, Buffer.from(e.DATA_ENCRYPTION_KEY, "base64")]]);
  // Previous keys stay available for decryption during rotation:
  // DATA_ENCRYPTION_KEY_<ID>=<base64>
  for (const [name, value] of Object.entries(process.env)) {
    const m = /^DATA_ENCRYPTION_KEY_([A-Za-z0-9_-]{1,16})$/.exec(name);
    if (m && m[1] !== "ID" && value) keys.set(m[1]!, Buffer.from(value, "base64"));
  }
  return { currentId: e.DATA_ENCRYPTION_KEY_ID, keys };
}

export function encrypt(plaintext: string): string {
  const { currentId, keys } = keyring();
  const key = keys.get(currentId)!;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // Bind the key id into the authenticated data so it can't be swapped.
  cipher.setAAD(Buffer.from(`${VERSION}.${currentId}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, currentId, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decrypt(payload: string): string {
  const parts = payload.split(".");
  if (parts.length !== 5 || parts[0] !== VERSION) throw new Error("Unrecognised ciphertext format");
  const [version, keyId, iv, tag, data] = parts as [string, string, string, string, string];
  const key = keyring().keys.get(keyId);
  if (!key) throw new Error(`Unknown encryption key id "${keyId}"`);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(`${version}.${keyId}`));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptNullable(value: string | null | undefined): string | null {
  return value == null || value === "" ? null : encrypt(value);
}

export function decryptNullable(value: string | null | undefined): string | null {
  return value == null ? null : decrypt(value);
}

/**
 * Deterministic keyed hash for equality lookups on encrypted columns
 * (e.g. `phone_hash`) and for pseudonymising IPs. HMAC-SHA256, hex.
 */
export function lookupHash(value: string, purpose: string): string {
  return createHmac("sha256", Buffer.from(env().DATA_HASH_KEY, "base64"))
    .update(`${purpose}:${value}`)
    .digest("hex");
}

/** Normalises a Nigerian phone number to E.164 (+234…). Returns null if invalid. */
export function normaliseNigerianPhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "");
  let national: string;
  if (digits.startsWith("+234")) national = digits.slice(4);
  else if (digits.startsWith("234")) national = digits.slice(3);
  else if (digits.startsWith("0")) national = digits.slice(1);
  else national = digits;
  return /^[789][01]\d{8}$/.test(national) ? `+234${national}` : null;
}

export const phoneHash = (e164: string) => lookupHash(e164, "phone");
export const ipHash = (ip: string) => lookupHash(ip, "ip");

/** Random URL-safe token for emails and sessions. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Tokens are stored hashed, so a database leak doesn't leak live links. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
