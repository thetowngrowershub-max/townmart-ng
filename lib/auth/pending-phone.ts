import "server-only";
import { decrypt, encrypt } from "@/lib/crypto";
import { redis } from "@/lib/redis";

/**
 * The phone number someone typed at sign-up, held for 30 minutes (encrypted)
 * while they type the code we texted it. Nothing is saved on the account
 * until the code is right, so nobody can claim a number that isn't theirs.
 */
const key = (userId: string) => `signup-phone:${userId}`;
export const PENDING_PHONE_MINUTES = 30;

export async function setPendingPhone(userId: string, e164: string): Promise<void> {
  await redis.set(key(userId), encrypt(e164), "EX", PENDING_PHONE_MINUTES * 60);
}

export async function readPendingPhone(userId: string): Promise<string | null> {
  const v = await redis.get(key(userId)).catch(() => null);
  if (!v) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
  }
}

export async function clearPendingPhone(userId: string): Promise<void> {
  await redis.del(key(userId)).catch(() => undefined);
}
