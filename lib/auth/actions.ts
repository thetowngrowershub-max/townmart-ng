"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { writeAudit } from "@/lib/audit";
import { assertCan } from "@/lib/authz";
import { decrypt, sha256 } from "@/lib/crypto";
import { prisma, withRls } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { resetPasswordTemplate, verifyEmailTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { recordAcceptances } from "@/lib/legal/documents";
import { issueOtp } from "@/lib/otp";
import { requestMeta } from "@/lib/request";
import { verifyTurnstile } from "@/lib/turnstile";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  safeNextPath,
  signInSchema,
  signUpSchema,
  verifyEmailSchema,
  type ForgotPasswordInput,
  type ResetPasswordInput,
  type SignInInput,
  type SignUpInput,
} from "@/lib/validation/auth";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import {
  LOCKOUT_MINUTES,
  MAX_FAILED_LOGINS,
  RESET_PASSWORD_TTL_MINUTES,
  tokenIdentifier,
  VERIFY_EMAIL_TTL_HOURS,
} from "./constants";
import { signIn as authJsSignIn } from "./config";
import { completeSignIn } from "./complete-sign-in";
import { consumeToken, issueToken } from "./tokens";
import { setPendingTwoFactor } from "./two-factor";
import { getCurrentUser } from "./current-user";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "./password";
import { createUserSession, currentSessionToken, destroyCurrentSession } from "./session";

const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

async function sendVerificationEmail(user: { email: string; name: string | null }): Promise<void> {
  const token = await issueToken(tokenIdentifier.verifyEmail(user.email), VERIFY_EMAIL_TTL_HOURS * 3600_000);
  const url = new URL("/auth/verify", env().APP_URL);
  url.searchParams.set("email", user.email);
  url.searchParams.set("token", token);
  await enqueueEmail(verifyEmailTemplate({ to: user.email, name: user.name, url: url.toString() }));
}

// ─── Sign up ────────────────────────────────────────────────────────────────

export async function signUpAction(input: SignUpInput): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { name, email, password, turnstileToken, marketingEmail } = parsed.data;
  const meta = await requestMeta();

  if (!(await rateLimit(`auth:sign-up:ip:${meta.ipHash}`, 5, 3600)).allowed) return { ok: false, error: TOO_MANY };
  if (!(await verifyTurnstile(turnstileToken, meta.ip))) {
    return { ok: false, error: "We couldn't verify you're human. Please try again." };
  }

  const passwordHash = await hashPassword(password);
  let userId: string;
  try {
    const user = await prisma.user.create({ data: { name, email, passwordHash }, select: { id: true } });
    userId = user.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, error: "An account with this email already exists.", fieldErrors: { email: ["Already registered"] } };
    }
    throw err;
  }

  await withRls({ userId }, async (tx) => {
    await tx.userRole.create({ data: { userId, role: "customer" } });
    const accepted = await recordAcceptances(tx, { context: "sign_up", userId, ipHash: meta.ipHash, userAgent: meta.userAgent });
    // Offers are opt-in, separate from the terms.
    if (marketingEmail) await tx.notificationPreference.create({ data: { userId, marketingEmail: true, marketingEmailAt: new Date() } });
    await writeAudit(tx, {
      actorUserId: userId,
      actorRole: "customer",
      action: "user.sign_up",
      entityType: "user",
      entityId: userId,
      after: { name, method: "password", accepted, marketingEmail },
      ipHash: meta.ipHash,
    });
  });

  try {
    await sendVerificationEmail({ email, name });
  } catch (err) {
    // The account exists; the user can resend from their account page.
    logger.error({ err, userId }, "failed to queue verification email");
  }

  await createUserSession(userId, meta);
  redirect("/account?welcome=1");
}

// ─── Sign in / out ──────────────────────────────────────────────────────────

export async function signInAction(input: SignInInput): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { email, password, next } = parsed.data;
  const meta = await requestMeta();

  const [byIp, byEmail] = await Promise.all([
    rateLimit(`auth:sign-in:ip:${meta.ipHash}`, 20, 900),
    rateLimit(`auth:sign-in:email:${sha256(email)}`, 10, 900),
  ]);
  if (!byIp.allowed || !byEmail.allowed) return { ok: false, error: TOO_MANY };

  const invalid: ActionResult = { ok: false, error: "Incorrect email or password." };
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, status: true, lockedUntil: true, failedLoginCount: true, twoFactorEnabledAt: true, phoneEncrypted: true, phoneHash: true, phoneVerifiedAt: true },
  });

  if (!user?.passwordHash) {
    await verifyAgainstDummy(password);
    return invalid;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, error: `This account is temporarily locked after too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes or reset your password.` };
  }

  if (!(await verifyPassword(user.passwordHash, password))) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : undefined,
      },
    });
    if (lock) {
      await withRls({ userId: user.id }, (tx) =>
        writeAudit(tx, { actorUserId: null, action: "user.locked_out", entityType: "user", entityId: user.id, ipHash: meta.ipHash }),
      );
    }
    return invalid;
  }

  if (user.status !== "active" && user.status !== "pending_deletion") {
    return { ok: false, error: "This account is not active. Please contact support." };
  }
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });

  // Two-step sign-in: a code to the verified phone before any session exists.
  if (user.twoFactorEnabledAt && user.phoneVerifiedAt && user.phoneEncrypted && user.phoneHash) {
    const sent = await issueOtp({ phoneE164: decrypt(user.phoneEncrypted), phoneHash: user.phoneHash, purpose: "two_factor", userId: user.id });
    if (!sent.ok) return { ok: false, error: sent.error };
    await setPendingTwoFactor(user.id, next ?? null);
    redirect("/auth/two-factor");
  }
  redirect(await completeSignIn(user.id, next ?? null, meta));
}

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const next = safeNextPath.parse(formData.get("next")?.toString());
  await authJsSignIn("google", { redirectTo: next ?? "/account" });
}

/** Links Google to the signed-in account: Auth.js links a new provider to the current session's user. */
export async function connectGoogleAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/account/security");
  await authJsSignIn("google", { redirectTo: "/account/security?google=connected" });
}

export async function disconnectGoogleAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { passwordHash: true, phoneVerifiedAt: true } });
  // Keep at least one way to sign in.
  if (!account.passwordHash && !account.phoneVerifiedAt) {
    return { ok: false, error: "Set a password (Forgot password) or verify a phone number first, so you can still sign in." };
  }
  const meta = await requestMeta();
  await prisma.account.deleteMany({ where: { userId: user.id, provider: "google" } });
  await withRls({ userId: user.id }, (tx) => writeAudit(tx, { actorUserId: user.id, action: "user.google_disconnected", entityType: "user", entityId: user.id, ipHash: meta.ipHash }));
  return { ok: true, message: "Google is disconnected." };
}

export async function signOutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/");
}

/** "Sign out everywhere": revokes every session for the current user, including this one. */
export async function signOutEverywhereAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in");
  assertCan(user, "session.revoke", { userId: user.id });
  const meta = await requestMeta();

  const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
  await withRls({ userId: user.id }, (tx) =>
    writeAudit(tx, {
      actorUserId: user.id,
      action: "user.sessions_revoked",
      entityType: "user",
      entityId: user.id,
      after: { sessions: count },
      ipHash: meta.ipHash,
    }),
  );
  await destroyCurrentSession();
  redirect("/auth/sign-in?signedOut=all");
}

/** Revokes one of the current user's other sessions. */
export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in required" };
  const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { userId: true, sessionToken: true } });
  if (!session) return { ok: true };
  assertCan(user, "session.revoke", { userId: session.userId });
  if (session.sessionToken === (await currentSessionToken())) {
    return { ok: false, error: "Use “Sign out” to end the session you're using." };
  }
  await prisma.session.delete({ where: { id: sessionId } });
  return { ok: true };
}

// ─── Email verification ─────────────────────────────────────────────────────

export async function verifyEmailAction(input: { email: string; token: string }): Promise<ActionResult> {
  const parsed = verifyEmailSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This verification link is invalid." };
  const { email, token } = parsed.data;

  if (!(await consumeToken(tokenIdentifier.verifyEmail(email), token))) {
    return { ok: false, error: "This verification link is invalid or has expired. Sign in and request a new one." };
  }
  const user = await prisma.user.update({ where: { email }, data: { emailVerified: new Date() }, select: { id: true } });
  await withRls({ userId: user.id }, (tx) =>
    writeAudit(tx, { actorUserId: user.id, action: "user.email_verified", entityType: "user", entityId: user.id }),
  );
  return { ok: true, message: "Your email address is confirmed." };
}

export async function resendVerificationAction(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sign in required" };
  if (user.emailVerified) return { ok: true, message: "Your email is already confirmed." };
  if (!(await rateLimit(`auth:verify-resend:${user.id}`, 3, 3600)).allowed) return { ok: false, error: TOO_MANY };
  await sendVerificationEmail(user);
  return { ok: true, message: `We've sent a new link to ${user.email}.` };
}

// ─── Password reset ─────────────────────────────────────────────────────────

const RESET_SENT = "If an account exists for that email, we've sent a link to reset the password.";

export async function requestPasswordResetAction(input: ForgotPasswordInput): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { email, turnstileToken } = parsed.data;
  const meta = await requestMeta();

  if (!(await rateLimit(`auth:reset:ip:${meta.ipHash}`, 10, 3600)).allowed) return { ok: false, error: TOO_MANY };
  if (!(await verifyTurnstile(turnstileToken, meta.ip))) {
    return { ok: false, error: "We couldn't verify you're human. Please try again." };
  }
  // Per-email limit returns the same message so it can't be used to probe accounts.
  if (!(await rateLimit(`auth:reset:email:${sha256(email)}`, 3, 3600)).allowed) return { ok: true, message: RESET_SENT };

  const user = await prisma.user.findUnique({ where: { email }, select: { status: true } });
  if (user && user.status === "active") {
    const token = await issueToken(tokenIdentifier.resetPassword(email), RESET_PASSWORD_TTL_MINUTES * 60_000);
    const url = new URL("/auth/reset-password", env().APP_URL);
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    await enqueueEmail(resetPasswordTemplate({ to: email, url: url.toString() }));
  }
  return { ok: true, message: RESET_SENT };
}

export async function resetPasswordAction(input: ResetPasswordInput): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { email, token, password } = parsed.data;
  const meta = await requestMeta();

  if (!(await rateLimit(`auth:reset-confirm:ip:${meta.ipHash}`, 10, 900)).allowed) return { ok: false, error: TOO_MANY };
  if (!(await consumeToken(tokenIdentifier.resetPassword(email), token))) {
    return { ok: false, error: "This reset link is invalid or has expired. Please request a new one." };
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.update({
    where: { email },
    // Completing a reset proves control of the inbox, so the email is verified too.
    data: { passwordHash, failedLoginCount: 0, lockedUntil: null, emailVerified: new Date() },
    select: { id: true },
  });
  // A password reset signs the account out everywhere.
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await withRls({ userId: user.id }, (tx) =>
    writeAudit(tx, { actorUserId: user.id, action: "user.password_reset", entityType: "user", entityId: user.id, ipHash: meta.ipHash }),
  );
  return { ok: true, message: "Your password has been changed. Please sign in." };
}
