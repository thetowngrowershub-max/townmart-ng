import { randomInt } from "node:crypto";

/**
 * One-time backup codes for two-step sign-in, for when the phone is lost or
 * has no signal. Ten codes like "k7m4-x9qp", shown once, stored only as keyed
 * hashes, each usable once. No 0/o/1/l/i so they're easy to read back.
 */
export const BACKUP_CODE_COUNT = 10;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const one = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return Array.from({ length: count }, () => {
    const c = one();
    return `${c.slice(0, 4)}-${c.slice(4)}`;
  });
}

/** Lower case, no spaces or dashes: "K7M4 X9QP" and "k7m4-x9qp" are the same code. */
export function normaliseBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "");
}

export function looksLikeBackupCode(code: string): boolean {
  return /^[a-z0-9]{8}$/.test(normaliseBackupCode(code));
}
