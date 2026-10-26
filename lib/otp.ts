import type { OtpPurpose } from "@prisma/client";
import { randomInt } from "node:crypto";
import { lookupHash } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { enqueueSms } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";

/**
 * One-time codes sent by SMS. Codes are 6 digits, valid for 10 minutes, allow
 * 5 attempts, and are stored only as keyed hashes. otp_codes is not RLS-scoped:
 * it is addressed by phone hash and only touched from these functions.
 */
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;

const codeHash = (phoneHash: string, purpose: OtpPurpose, code: string) => lookupHash(`${phoneHash}:${purpose}:${code}`, "otp");

export type IssueOtpResult = { ok: true } | { ok: false; error: string };

export async function issueOtp(params: { phoneE164: string; phoneHash: string; purpose: OtpPurpose; userId?: string | null }): Promise<IssueOtpResult> {
  const { phoneE164, phoneHash, purpose, userId } = params;
  const limit = await rateLimit(`otp:${purpose}:${phoneHash}`, 3, 600);
  if (!limit.allowed) return { ok: false, error: "Too many codes requested. Please wait 10 minutes." };

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  await prisma.$transaction([
    // Only the newest code for a phone + purpose is valid.
    prisma.otpCode.deleteMany({ where: { phoneHash, purpose, usedAt: null } }),
    prisma.otpCode.create({
      data: {
        phoneHash,
        userId: userId ?? null,
        purpose,
        codeHash: codeHash(phoneHash, purpose, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    }),
  ]);
  await enqueueSms({ to: phoneE164, body: `Your TownMart code is ${code}. It expires in ${OTP_TTL_MINUTES} minutes. Never share it.` });
  return { ok: true };
}

export type VerifyOtpResult = { ok: true; userId: string | null } | { ok: false; error: string };

export async function verifyOtp(params: { phoneHash: string; purpose: OtpPurpose; code: string }): Promise<VerifyOtpResult> {
  const { phoneHash, purpose, code } = params;
  const otp = await prisma.otpCode.findFirst({
    where: { phoneHash, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp || otp.expiresAt < new Date()) return { ok: false, error: "This code has expired. Request a new one." };
  if (otp.attempts >= OTP_MAX_ATTEMPTS) return { ok: false, error: "Too many wrong attempts. Request a new code." };

  if (otp.codeHash !== codeHash(phoneHash, purpose, code.trim())) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    return { ok: false, error: "That code isn't right." };
  }
  // Single use: only one concurrent verifier can flip used_at.
  const { count } = await prisma.otpCode.updateMany({ where: { id: otp.id, usedAt: null }, data: { usedAt: new Date() } });
  if (count !== 1) return { ok: false, error: "This code has already been used." };
  return { ok: true, userId: otp.userId };
}
