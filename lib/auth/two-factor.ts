import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Two-step sign-in. After a correct password, an account with two-step
 * sign-in on gets a code by SMS to its verified phone instead of a session.
 * Until the code is entered, the browser holds only this short-lived signed
 * cookie naming the user; it grants nothing by itself.
 */
export const TWO_FACTOR_COOKIE = "tm_2fa";
export const TWO_FACTOR_MINUTES = 10;

type Pending = { userId: string; next: string | null; exp: number };

const sign = (payload: string) => createHmac("sha256", env().AUTH_SECRET).update(`2fa:${payload}`).digest("base64url");

export function encodePending(p: Pending): string {
  const payload = [p.userId, p.exp, Buffer.from(p.next ?? "").toString("base64url")].join(".");
  return `${payload}.${sign(payload)}`;
}

export function decodePending(value: string | undefined, now = Date.now()): Pending | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [userId, exp, next, mac] = parts as [string, string, string, string];
  const expected = Buffer.from(sign(`${userId}.${exp}.${next}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  const nextPath = Buffer.from(next, "base64url").toString("utf8");
  return { userId, exp: Number(exp), next: nextPath || null };
}

export async function setPendingTwoFactor(userId: string, next: string | null): Promise<void> {
  (await cookies()).set(TWO_FACTOR_COOKIE, encodePending({ userId, next, exp: Date.now() + TWO_FACTOR_MINUTES * 60_000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: TWO_FACTOR_MINUTES * 60,
  });
}

export async function readPendingTwoFactor(): Promise<Pending | null> {
  return decodePending((await cookies()).get(TWO_FACTOR_COOKIE)?.value);
}

export async function clearPendingTwoFactor(): Promise<void> {
  (await cookies()).delete(TWO_FACTOR_COOKIE);
}
