import "server-only";
import type { TwoFactorMethod } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { decrypt, decryptNullable, encrypt, lookupHash } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { emailOtpKey, issueEmailOtp, issueOtp, verifyOtp, type IssueOtpResult } from "@/lib/otp";
import { generateBackupCodes, looksLikeBackupCode, normaliseBackupCode } from "./backup-codes";
import { verifyTotp } from "./totp";
import { setPendingTwoFactor, type FirstFactor } from "./two-factor";

/**
 * The ways to pass the second step of signing in, for every kind of account
 * (shoppers, sellers, service providers, staff and admins):
 *
 *  - authenticator: a 6-digit code from an authenticator app. Recommended:
 *    free, works without signal, and can't be stolen by a SIM swap.
 *  - sms:   a code texted to the verified phone (Termii in production).
 *  - email: a code emailed to the verified address. Always offered as a
 *           fallback when the email is verified.
 *  - backup: one of ten one-time backup codes shown when it was turned on.
 *
 * A sign-in that started with a text-message code can't use a text message as
 * its second step, because that would be the same thing twice.
 */
export type Factor = TwoFactorMethod | "backup";

export const FACTOR_LABELS: Record<Factor, string> = {
  authenticator: "Authenticator app",
  sms: "Text message",
  email: "Email",
  backup: "Backup code",
};

const twoFactorSelect = {
  id: true,
  email: true,
  name: true,
  emailVerified: true,
  phoneEncrypted: true,
  phoneHash: true,
  phoneVerifiedAt: true,
  twoFactorEnabledAt: true,
  twoFactorMethod: true,
  totpSecretEncrypted: true,
  totpLastStep: true,
  twoFactorBackupCodes: true,
} satisfies Prisma.UserSelect;

export type TwoFactorUser = Prisma.UserGetPayload<{ select: typeof twoFactorSelect }>;

export function loadTwoFactorUser(userId: string): Promise<TwoFactorUser | null> {
  return prisma.user.findUnique({ where: { id: userId }, select: twoFactorSelect });
}

export const isTwoFactorOn = (u: Pick<TwoFactorUser, "twoFactorEnabledAt">) => u.twoFactorEnabledAt !== null;

/** Which channels this account could use at all, on or off. */
export function channelsFor(u: TwoFactorUser): Record<TwoFactorMethod, boolean> {
  return {
    authenticator: u.totpSecretEncrypted !== null,
    sms: u.phoneVerifiedAt !== null && u.phoneHash !== null && u.phoneEncrypted !== null,
    email: u.emailVerified !== null,
  };
}

/** The second steps offered for a sign-in, the account's preferred one first. */
export function factorsFor(u: TwoFactorUser, via: FirstFactor | null): Factor[] {
  const ch = channelsFor(u);
  const order: TwoFactorMethod[] = ["authenticator", "sms", "email"];
  const preferred = u.twoFactorMethod;
  const list: Factor[] = [];
  for (const m of preferred ? [preferred, ...order.filter((o) => o !== preferred)] : order) {
    if (!ch[m]) continue;
    if (m === "sms" && via === "sms") continue;
    list.push(m);
  }
  if (u.twoFactorBackupCodes.length > 0) list.push("backup");
  return list;
}

/** Sends a code for a factor that needs one (text message or email). */
export async function sendFactorCode(u: TwoFactorUser, factor: "sms" | "email"): Promise<IssueOtpResult> {
  if (factor === "sms") {
    if (!channelsFor(u).sms) return { ok: false, error: "There's no verified phone number on this account." };
    return issueOtp({ phoneE164: decrypt(u.phoneEncrypted!), phoneHash: u.phoneHash!, purpose: "two_factor", userId: u.id });
  }
  if (!channelsFor(u).email) return { ok: false, error: "Confirm your email address first." };
  return issueEmailOtp({ userId: u.id, email: u.email, name: u.name });
}

export const backupCodeHash = (userId: string, code: string) => lookupHash(`${userId}:${normaliseBackupCode(code)}`, "2fa-backup");

export type FactorCheck = { ok: true } | { ok: false; error: string };
const WRONG = "That code isn't right.";

/** Checks (and uses up) a second-step code. Codes from every factor work once. */
export async function checkFactor(u: TwoFactorUser, factor: Factor, rawCode: string): Promise<FactorCheck> {
  const code = rawCode.trim();
  switch (factor) {
    case "authenticator": {
      const secret = decryptNullable(u.totpSecretEncrypted);
      if (!secret) return { ok: false, error: "No authenticator app is set up on this account." };
      const step = verifyTotp(secret, code, { lastStep: u.totpLastStep });
      if (step === null) return { ok: false, error: WRONG };
      // Only one request can move the last-used step forward, so a code can't be replayed.
      const { count } = await prisma.user.updateMany({
        where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
        data: { totpLastStep: step },
      });
      return count === 1 ? { ok: true } : { ok: false, error: "This code has already been used. Wait for the next one." };
    }
    case "sms": {
      if (!u.phoneHash) return { ok: false, error: WRONG };
      if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code" };
      const r = await verifyOtp({ phoneHash: u.phoneHash, purpose: "two_factor", code });
      if (!r.ok) return r;
      return r.userId === u.id ? { ok: true } : { ok: false, error: WRONG };
    }
    case "email": {
      if (!/^\d{6}$/.test(code)) return { ok: false, error: "Enter the 6-digit code" };
      const r = await verifyOtp({ phoneHash: emailOtpKey(u.id), purpose: "two_factor_email", code });
      if (!r.ok) return r;
      return r.userId === u.id ? { ok: true } : { ok: false, error: WRONG };
    }
    case "backup": {
      if (!looksLikeBackupCode(code)) return { ok: false, error: "Enter a backup code like k7m4-x9qp" };
      const hash = backupCodeHash(u.id, code);
      // Removing the hash and checking it was there is one statement, so each code works once.
      const count = await prisma.$executeRaw`
        UPDATE users SET two_factor_backup_codes = array_remove(two_factor_backup_codes, ${hash})
        WHERE id = ${u.id}::uuid AND ${hash} = ANY(two_factor_backup_codes)`;
      return count === 1 ? { ok: true } : { ok: false, error: "That backup code isn't right or was already used." };
    }
  }
}

/** New backup codes: returns the plain codes to show once and the hashes to store. */
export function newBackupCodes(userId: string): { codes: string[]; hashes: string[] } {
  const codes = generateBackupCodes();
  return { codes, hashes: codes.map((c) => backupCodeHash(userId, c)) };
}

/**
 * After the first step of a sign-in: parks the sign-in in the pending cookie
 * and, when the preferred second step is a text or an email, sends that code.
 * The caller then redirects to /auth/two-factor.
 */
export async function startSecondStep(u: TwoFactorUser, next: string | null, via: FirstFactor): Promise<IssueOtpResult> {
  const factors = factorsFor(u, via);
  const first = factors[0];
  if (!first) {
    return { ok: false, error: via === "sms" ? "Your account needs a second step we can't send by text. Sign in with your email and password instead." : "We can't reach any of your two-step sign-in methods. Please contact support." };
  }
  if (first === "sms" || first === "email") {
    const sent = await sendFactorCode(u, first);
    if (!sent.ok) return sent;
  }
  await setPendingTwoFactor(u.id, next, via);
  return { ok: true };
}

// ─── Authenticator set-up in progress ───────────────────────────────────────

/**
 * While someone scans the QR code, the new secret waits in a short-lived
 * encrypted cookie, not the database, so an abandoned set-up leaves nothing.
 */
const TOTP_SETUP_COOKIE = "tm_totp_setup";
const TOTP_SETUP_MINUTES = 15;

export async function setPendingTotpSecret(userId: string, secret: string): Promise<void> {
  const exp = Date.now() + TOTP_SETUP_MINUTES * 60_000;
  (await cookies()).set(TOTP_SETUP_COOKIE, encrypt(JSON.stringify({ userId, secret, exp })), {
    httpOnly: true,
    sameSite: "strict",
    secure: env().APP_URL.startsWith("https://"),
    path: "/",
    maxAge: TOTP_SETUP_MINUTES * 60,
  });
}

export async function readPendingTotpSecret(userId: string): Promise<string | null> {
  const raw = (await cookies()).get(TOTP_SETUP_COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(decrypt(raw)) as { userId?: string; secret?: string; exp?: number };
    if (v.userId !== userId || typeof v.secret !== "string" || typeof v.exp !== "number" || v.exp < Date.now()) return null;
    return v.secret;
  } catch {
    return null;
  }
}

export async function clearPendingTotpSecret(): Promise<void> {
  (await cookies()).delete(TOTP_SETUP_COOKIE);
}
