"use server";

import type { TwoFactorMethod } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { withRls } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { completeSignIn } from "./complete-sign-in";
import { getCurrentUser } from "./current-user";
import { formatSecret, generateTotpSecret, otpauthUrl, verifyTotp } from "./totp";
import { clearPendingTwoFactor, readPendingTwoFactor } from "./two-factor";
import {
  channelsFor,
  checkFactor,
  clearPendingTotpSecret,
  factorsFor,
  FACTOR_LABELS,
  isTwoFactorOn,
  loadTwoFactorUser,
  newBackupCodes,
  readPendingTotpSecret,
  sendFactorCode,
  setPendingTotpSecret,
  type Factor,
  type TwoFactorUser,
} from "./two-factor-methods";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const EXPIRED = "Your sign-in timed out. Please sign in again.";
const SIGNED_OUT = "Please sign in again.";

const factorEnum = z.enum(["authenticator", "sms", "email", "backup"]);
const methodEnum = z.enum(["authenticator", "sms", "email"]);
const codeField = z.string().trim().min(6, "Enter the code").max(20);
const factorCodeSchema = z.object({ factor: factorEnum, code: codeField });

const bad = (error: string): ActionResult<never> => ({ ok: false, error, fieldErrors: { code: [error] } });

async function audit(userId: string, action: string, details?: Record<string, unknown>) {
  const meta = await requestMeta();
  await withRls({ userId }, (tx) => writeAudit(tx, { actorUserId: userId, action, entityType: "user", entityId: userId, ipHash: meta.ipHash, ...(details ? { after: details } : {}) }));
}

// ─── At sign-in ─────────────────────────────────────────────────────────────

async function pendingUser(): Promise<{ user: TwoFactorUser; factors: Factor[]; next: string | null } | null> {
  const pending = await readPendingTwoFactor();
  if (!pending) return null;
  const user = await loadTwoFactorUser(pending.userId);
  if (!user || !isTwoFactorOn(user)) return null;
  return { user, factors: factorsFor(user, pending.via), next: pending.next };
}

export async function verifyTwoFactorAction(input: z.input<typeof factorCodeSchema>): Promise<ActionResult> {
  const parsed = factorCodeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const p = await pendingUser();
  if (!p) return { ok: false, error: EXPIRED };
  if (!(await rateLimit(`auth:2fa:${p.user.id}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };
  if (!p.factors.includes(parsed.data.factor)) return { ok: false, error: "Choose another way to sign in." };
  const check = await checkFactor(p.user, parsed.data.factor, parsed.data.code);
  if (!check.ok) return bad(check.error);
  await clearPendingTwoFactor();
  if (parsed.data.factor === "backup") await audit(p.user.id, "user.two_factor_backup_code_used", { remaining: p.user.twoFactorBackupCodes.length - 1 });
  redirect(await completeSignIn(p.user.id, p.next, await requestMeta()));
}

/** Sends (or re-sends) a text-message or email code during sign-in. */
export async function sendTwoFactorCodeAction(input: { factor: "sms" | "email" }): Promise<ActionResult> {
  const factor = z.enum(["sms", "email"]).safeParse(input.factor);
  if (!factor.success) return { ok: false, error: "Choose a way to get your code." };
  const p = await pendingUser();
  if (!p) return { ok: false, error: EXPIRED };
  if (!p.factors.includes(factor.data)) return { ok: false, error: "Choose another way to sign in." };
  const sent = await sendFactorCode(p.user, factor.data);
  return sent.ok ? { ok: true, message: factor.data === "sms" ? "We've texted you a code." : "We've emailed you a code." } : sent;
}

// ─── Profile & security ─────────────────────────────────────────────────────

async function me(): Promise<TwoFactorUser | null> {
  const u = await getCurrentUser();
  return u ? loadTwoFactorUser(u.id) : null;
}

/** Sends a code to confirm a change: to a channel being set up, or to an existing one. */
export async function sendSecurityCodeAction(input: { factor: "sms" | "email" }): Promise<ActionResult> {
  const factor = z.enum(["sms", "email"]).safeParse(input.factor);
  if (!factor.success) return { ok: false, error: "Choose where to send the code." };
  const user = await me();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const sent = await sendFactorCode(user, factor.data);
  return sent.ok ? { ok: true, message: factor.data === "sms" ? "We've texted you a code." : "We've emailed you a code." } : sent;
}

/** Turning two-step sign-in on for the first time also creates backup codes; they're returned once. */
async function enable(user: TwoFactorUser, method: TwoFactorMethod, extra: { totpSecretEncrypted?: string; totpLastStep?: number } = {}): Promise<string[] | null> {
  const first = !isTwoFactorOn(user) || user.twoFactorBackupCodes.length === 0;
  const backup = first ? newBackupCodes(user.id) : null;
  await withRls({ userId: user.id }, async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabledAt: user.twoFactorEnabledAt ?? new Date(),
        twoFactorMethod: method,
        ...extra,
        ...(backup ? { twoFactorBackupCodes: backup.hashes } : {}),
      },
    });
  });
  await audit(user.id, isTwoFactorOn(user) ? "user.two_factor_method_changed" : "user.two_factor_enabled", { method });
  revalidatePath("/account/security");
  return backup?.codes ?? null;
}

export type AuthenticatorSetup = { qrSvg: string; secret: string; url: string };

/** Starts linking an authenticator app: a new secret and its QR code. */
export async function startAuthenticatorSetupAction(): Promise<ActionResult<AuthenticatorSetup>> {
  const user = await me();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const secret = generateTotpSecret();
  await setPendingTotpSecret(user.id, secret);
  const url = otpauthUrl({ secret, account: user.email });
  const qrSvg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return { ok: true, data: { qrSvg, secret: formatSecret(secret), url } };
}

/** Confirms the app with its first code. Makes the app the preferred way. */
export async function confirmAuthenticatorAction(input: { code: string }): Promise<ActionResult<{ backupCodes: string[] | null }>> {
  const parsed = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the app") }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await me();
  if (!user) return { ok: false, error: SIGNED_OUT };
  if (!(await rateLimit(`auth:2fa-setup:${user.id}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };
  const secret = await readPendingTotpSecret(user.id);
  if (!secret) return { ok: false, error: "The set-up timed out. Start again to get a new QR code." };
  const step = verifyTotp(secret, parsed.data.code);
  if (step === null) return bad("That code isn't right. Check the time on your phone is set automatically.");
  await clearPendingTotpSecret();
  const backupCodes = await enable(user, "authenticator", { totpSecretEncrypted: encrypt(secret), totpLastStep: step });
  return { ok: true, data: { backupCodes }, message: "Your authenticator app is linked." };
}

/** Turns on (or switches to) text-message or email codes, confirmed with a code sent there. */
export async function confirmChannelAction(input: { method: "sms" | "email"; code: string }): Promise<ActionResult<{ backupCodes: string[] | null }>> {
  const parsed = z.object({ method: z.enum(["sms", "email"]), code: codeField }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await me();
  if (!user) return { ok: false, error: SIGNED_OUT };
  if (!(await rateLimit(`auth:2fa-setup:${user.id}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };
  if (!channelsFor(user)[parsed.data.method]) {
    return { ok: false, error: parsed.data.method === "sms" ? "Add and verify a phone number first." : "Confirm your email address first." };
  }
  const check = await checkFactor(user, parsed.data.method, parsed.data.code);
  if (!check.ok) return bad(check.error);
  const backupCodes = await enable(user, parsed.data.method);
  return { ok: true, data: { backupCodes }, message: `Two-step sign-in is on with ${parsed.data.method === "sms" ? "text-message" : "email"} codes.` };
}

/** Picks which ready channel is asked for first. Needs no code: every ready channel is already proven. */
export async function setPreferredMethodAction(input: { method: TwoFactorMethod }): Promise<ActionResult> {
  const method = methodEnum.safeParse(input.method);
  if (!method.success) return { ok: false, error: "Choose a method." };
  const user = await me();
  if (!user) return { ok: false, error: SIGNED_OUT };
  if (!isTwoFactorOn(user)) return { ok: false, error: "Turn on two-step sign-in first." };
  if (!channelsFor(user)[method.data]) return { ok: false, error: "Set that method up first." };
  await withRls({ userId: user.id }, (tx) => tx.user.update({ where: { id: user.id }, data: { twoFactorMethod: method.data } }));
  await audit(user.id, "user.two_factor_method_changed", { method: method.data });
  revalidatePath("/account/security");
  return { ok: true, message: `${FACTOR_LABELS[method.data]} is now asked for first.` };
}

/**
 * Changes that weaken the account (turning it off, unlinking the app, new
 * backup codes) need a fresh second-step code, so a stolen session alone
 * can't do them.
 */
async function stepUp(input: z.input<typeof factorCodeSchema>): Promise<{ ok: true; user: TwoFactorUser } | { ok: false; result: ActionResult<never> }> {
  const parsed = factorCodeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, result: validationError(parsed.error) };
  const user = await me();
  if (!user) return { ok: false, result: { ok: false, error: SIGNED_OUT } };
  if (!(await rateLimit(`auth:2fa-setup:${user.id}`, 10, 900)).allowed) return { ok: false, result: { ok: false, error: TOO_MANY } };
  if (!factorsFor(user, null).includes(parsed.data.factor)) return { ok: false, result: { ok: false, error: "Choose another way to confirm." } };
  const check = await checkFactor(user, parsed.data.factor, parsed.data.code);
  if (!check.ok) return { ok: false, result: bad(check.error) };
  return { ok: true, user };
}

export async function disableTwoFactorAction(input: z.input<typeof factorCodeSchema>): Promise<ActionResult> {
  const s = await stepUp(input);
  if (!s.ok) return s.result;
  await withRls({ userId: s.user.id }, (tx) =>
    tx.user.update({
      where: { id: s.user.id },
      data: { twoFactorEnabledAt: null, twoFactorMethod: null, totpSecretEncrypted: null, totpLastStep: null, twoFactorBackupCodes: [] },
    }),
  );
  await audit(s.user.id, "user.two_factor_disabled");
  revalidatePath("/account/security");
  return { ok: true, message: "Two-step sign-in is off." };
}

export async function removeAuthenticatorAction(input: z.input<typeof factorCodeSchema>): Promise<ActionResult> {
  const s = await stepUp(input);
  if (!s.ok) return s.result;
  const ch = channelsFor(s.user);
  // If the app was the preferred way, fall back to another ready channel.
  let method = s.user.twoFactorMethod;
  if (method === "authenticator") method = ch.sms ? "sms" : ch.email ? "email" : null;
  if (isTwoFactorOn(s.user) && method === null) return { ok: false, error: "Add a phone number or confirm your email before unlinking the app, or turn two-step sign-in off." };
  await withRls({ userId: s.user.id }, (tx) => tx.user.update({ where: { id: s.user.id }, data: { totpSecretEncrypted: null, totpLastStep: null, twoFactorMethod: method } }));
  await audit(s.user.id, "user.two_factor_authenticator_removed");
  revalidatePath("/account/security");
  return { ok: true, message: "Authenticator app unlinked." };
}

export async function regenerateBackupCodesAction(input: z.input<typeof factorCodeSchema>): Promise<ActionResult<{ backupCodes: string[] }>> {
  const s = await stepUp(input);
  if (!s.ok) return s.result;
  if (!isTwoFactorOn(s.user)) return { ok: false, error: "Turn on two-step sign-in first." };
  const backup = newBackupCodes(s.user.id);
  await withRls({ userId: s.user.id }, (tx) => tx.user.update({ where: { id: s.user.id }, data: { twoFactorBackupCodes: backup.hashes } }));
  await audit(s.user.id, "user.two_factor_backup_codes_regenerated");
  revalidatePath("/account/security");
  return { ok: true, data: { backupCodes: backup.codes }, message: "New backup codes made. The old ones no longer work." };
}
