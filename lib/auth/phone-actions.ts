"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { encrypt, phoneHash } from "@/lib/crypto";
import { prisma, withRls } from "@/lib/db";
import { issueOtp, verifyOtp } from "@/lib/otp";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { phoneCodeSchema, phoneOnlySchema, type PhoneCodeInput } from "@/lib/validation/auth";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { getCurrentUser } from "./current-user";
import { createUserSession } from "./session";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

// ─── Sign in with a phone number ────────────────────────────────────────────

/**
 * Sends a sign-in code only when the number belongs to an active account with a
 * verified phone, but always answers the same way so numbers can't be probed.
 */
export async function sendSignInCodeAction(input: { phone: string }): Promise<ActionResult> {
  const parsed = phoneOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const meta = await requestMeta();
  if (!(await rateLimit(`auth:phone-code:ip:${meta.ipHash}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };

  const hash = phoneHash(parsed.data.phone);
  const user = await prisma.user.findUnique({ where: { phoneHash: hash }, select: { id: true, status: true, phoneVerifiedAt: true } });
  if (user?.phoneVerifiedAt && user.status === "active") {
    const res = await issueOtp({ phoneE164: parsed.data.phone, phoneHash: hash, purpose: "sign_in", userId: user.id });
    if (!res.ok) return res;
  }
  return { ok: true, message: "If this number is linked to a TownMart account, we've texted it a 6-digit code." };
}

export async function verifySignInCodeAction(input: PhoneCodeInput): Promise<ActionResult> {
  const parsed = phoneCodeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { phone, code, next } = parsed.data;
  const meta = await requestMeta();
  if (!(await rateLimit(`auth:phone-verify:ip:${meta.ipHash}`, 20, 900)).allowed) return { ok: false, error: TOO_MANY };

  const check = await verifyOtp({ phoneHash: phoneHash(phone), purpose: "sign_in", code });
  if (!check.ok || !check.userId) return { ok: false, error: check.ok ? "That code isn't right." : check.error, fieldErrors: { code: [check.ok ? "That code isn't right." : check.error] } };

  const user = await prisma.user.findUnique({ where: { id: check.userId }, select: { id: true, status: true, lockedUntil: true } });
  if (!user || user.status !== "active") return { ok: false, error: "This account is not active. Please contact support." };
  if (user.lockedUntil && user.lockedUntil > new Date()) return { ok: false, error: "This account is temporarily locked. Try again later." };

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), failedLoginCount: 0 } });
  await withRls({ userId: user.id }, (tx) => writeAudit(tx, { actorUserId: user.id, action: "user.signed_in_phone", entityType: "user", entityId: user.id, ipHash: meta.ipHash }));
  await createUserSession(user.id, meta);
  redirect(next ?? "/account");
}

// ─── Add or change the phone on your account ───────────────────────────────

export async function sendPhoneVerificationCodeAction(input: { phone: string }): Promise<ActionResult> {
  const parsed = phoneOnlySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const hash = phoneHash(parsed.data.phone);
  const owner = await prisma.user.findUnique({ where: { phoneHash: hash }, select: { id: true } });
  if (owner && owner.id !== user.id) return { ok: false, error: "This number is linked to another account.", fieldErrors: { phone: ["Linked to another account"] } };
  const res = await issueOtp({ phoneE164: parsed.data.phone, phoneHash: hash, purpose: "verify_phone", userId: user.id });
  return res.ok ? { ok: true, message: "Code sent. It expires in 10 minutes." } : res;
}

export async function verifyAccountPhoneAction(input: { phone: string; code: string }): Promise<ActionResult> {
  const parsed = phoneCodeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const meta = await requestMeta();

  const hash = phoneHash(parsed.data.phone);
  const check = await verifyOtp({ phoneHash: hash, purpose: "verify_phone", code: parsed.data.code });
  // The code must have been issued to this user, not just to this number.
  if (!check.ok || check.userId !== user.id) {
    const error = check.ok ? "That code isn't right." : check.error;
    return { ok: false, error, fieldErrors: { code: [error] } };
  }
  try {
    await prisma.user.update({ where: { id: user.id }, data: { phoneEncrypted: encrypt(parsed.data.phone), phoneHash: hash, phoneVerifiedAt: new Date() } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, error: "This number is linked to another account." };
    throw err;
  }
  await withRls({ userId: user.id }, (tx) => writeAudit(tx, { actorUserId: user.id, action: "user.phone_verified", entityType: "user", entityId: user.id, ipHash: meta.ipHash }));
  revalidatePath("/account/security");
  return { ok: true, message: "Phone number verified. You can now sign in with it." };
}

export async function removeAccountPhoneAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const meta = await requestMeta();
  const current = await prisma.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabledAt: true } });
  if (current?.twoFactorEnabledAt) return { ok: false, error: "Turn off two-step sign-in before removing your phone number." };
  await prisma.user.update({ where: { id: user.id }, data: { phoneEncrypted: null, phoneHash: null, phoneVerifiedAt: null } });
  await withRls({ userId: user.id }, (tx) => writeAudit(tx, { actorUserId: user.id, action: "user.phone_removed", entityType: "user", entityId: user.id, ipHash: meta.ipHash }));
  revalidatePath("/account/security");
  return { ok: true, message: "Phone number removed." };
}
