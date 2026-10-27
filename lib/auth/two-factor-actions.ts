"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { decrypt } from "@/lib/crypto";
import { prisma, withRls } from "@/lib/db";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { otpCode } from "@/lib/validation/common";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { completeSignIn } from "./complete-sign-in";
import { getCurrentUser } from "./current-user";
import { clearPendingTwoFactor, readPendingTwoFactor } from "./two-factor";

const codeSchema = z.object({ code: otpCode });
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";
const EXPIRED = "Your sign-in timed out. Please sign in again.";

async function phoneOf(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: { phoneEncrypted: true, phoneHash: true, phoneVerifiedAt: true, twoFactorEnabledAt: true } });
}

// ─── At sign-in ─────────────────────────────────────────────────────────────

export async function verifyTwoFactorAction(input: z.input<typeof codeSchema>): Promise<ActionResult> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const pending = await readPendingTwoFactor();
  if (!pending) return { ok: false, error: EXPIRED };
  if (!(await rateLimit(`auth:2fa:${pending.userId}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };
  const user = await phoneOf(pending.userId);
  if (!user?.phoneHash) return { ok: false, error: EXPIRED };
  const result = await verifyOtp({ phoneHash: user.phoneHash, purpose: "two_factor", code: parsed.data.code });
  if (!result.ok) return { ok: false, error: result.error, fieldErrors: { code: [result.error] } };
  if (result.userId !== pending.userId) return { ok: false, error: EXPIRED };
  await clearPendingTwoFactor();
  redirect(await completeSignIn(pending.userId, pending.next, await requestMeta()));
}

export async function resendTwoFactorAction(): Promise<ActionResult> {
  const pending = await readPendingTwoFactor();
  if (!pending) return { ok: false, error: EXPIRED };
  const user = await phoneOf(pending.userId);
  if (!user?.phoneEncrypted || !user.phoneHash) return { ok: false, error: EXPIRED };
  const sent = await issueOtp({ phoneE164: decrypt(user.phoneEncrypted), phoneHash: user.phoneHash, purpose: "two_factor", userId: pending.userId });
  return sent.ok ? { ok: true, message: "We've sent a new code." } : sent;
}

// ─── Turning it on and off (Profile & security) ─────────────────────────────

/** Sends a code to the verified phone; entering it confirms the change. */
export async function sendTwoFactorSetupCodeAction(): Promise<ActionResult> {
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Please sign in again." };
  const user = await phoneOf(me.id);
  if (!user?.phoneVerifiedAt || !user.phoneEncrypted || !user.phoneHash) return { ok: false, error: "Add and verify a phone number first." };
  const sent = await issueOtp({ phoneE164: decrypt(user.phoneEncrypted), phoneHash: user.phoneHash, purpose: "two_factor", userId: me.id });
  return sent.ok ? { ok: true, message: "We've sent a code to your phone." } : sent;
}

export async function setTwoFactorAction(input: { code: string; enable: boolean }): Promise<ActionResult> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const me = await getCurrentUser();
  if (!me) return { ok: false, error: "Please sign in again." };
  if (!(await rateLimit(`auth:2fa-setup:${me.id}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };
  const user = await phoneOf(me.id);
  if (!user?.phoneHash || !user.phoneVerifiedAt) return { ok: false, error: "Add and verify a phone number first." };
  const result = await verifyOtp({ phoneHash: user.phoneHash, purpose: "two_factor", code: parsed.data.code });
  if (!result.ok || result.userId !== me.id) return { ok: false, error: result.ok ? "That code isn't right." : result.error, fieldErrors: { code: [result.ok ? "That code isn't right." : result.error] } };
  const meta = await requestMeta();
  await withRls({ userId: me.id }, async (tx) => {
    await tx.user.update({ where: { id: me.id }, data: { twoFactorEnabledAt: input.enable ? new Date() : null } });
    await writeAudit(tx, { actorUserId: me.id, action: input.enable ? "user.two_factor_enabled" : "user.two_factor_disabled", entityType: "user", entityId: me.id, ipHash: meta.ipHash });
  });
  return { ok: true, message: input.enable ? "Two-step sign-in is on." : "Two-step sign-in is off." };
}
