import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * Two-step sign-in. After the first step (a password, a text-message sign-in
 * code or Google), an account with two-step sign-in on gets no session yet.
 * Until the second code is entered, the browser holds only this short-lived
 * signed cookie naming the user and how they started; it grants nothing by
 * itself. Which second steps are offered: lib/auth/two-factor-methods.ts.
 */
export const TWO_FACTOR_COOKIE = "tm_2fa";
export const TWO_FACTOR_MINUTES = 10;

/** How the sign-in started. A text-message sign-in can't use a text message as its second step. */
export type FirstFactor = "password" | "sms" | "google";
const FIRST_FACTORS: readonly FirstFactor[] = ["password", "sms", "google"];

type Pending = { userId: string; next: string | null; exp: number; via: FirstFactor };

const sign = (payload: string) => createHmac("sha256", env().AUTH_SECRET).update(`2fa:${payload}`).digest("base64url");

export function encodePending(p: Pending): string {
  const payload = [p.userId, p.exp, Buffer.from(p.next ?? "").toString("base64url"), p.via].join(".");
  return `${payload}.${sign(payload)}`;
}

export function decodePending(value: string | undefined, now = Date.now()): Pending | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 5) return null;
  const [userId, exp, next, via, mac] = parts as [string, string, string, string, string];
  const expected = Buffer.from(sign(`${userId}.${exp}.${next}.${via}`));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  if (!/^\d+$/.test(exp) || Number(exp) < now) return null;
  if (!FIRST_FACTORS.includes(via as FirstFactor)) return null;
  const nextPath = Buffer.from(next, "base64url").toString("utf8");
  return { userId, exp: Number(exp), next: nextPath || null, via: via as FirstFactor };
}

export async function setPendingTwoFactor(userId: string, next: string | null, via: FirstFactor = "password"): Promise<void> {
  (await cookies()).set(TWO_FACTOR_COOKIE, encodePending({ userId, next, via, exp: Date.now() + TWO_FACTOR_MINUTES * 60_000 }), {
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
