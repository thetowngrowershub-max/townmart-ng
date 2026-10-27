"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { tokenIdentifier } from "@/lib/auth/constants";
import { getCurrentUser } from "@/lib/auth/current-user";
import { destroyCurrentSession } from "@/lib/auth/session";
import { issueToken } from "@/lib/auth/tokens";
import { assertCan, AuthzError } from "@/lib/authz";
import { withRls, withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { enqueueDataExport, enqueueEmail } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { verifyTurnstile } from "@/lib/turnstile";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { deletionSchema, privacyRequestSchema, publicDataRequestSchema, rectifyNameSchema } from "@/lib/validation/privacy";
import { requestAccountDeletion } from "./account";
import { createDataRequest, DataRequestError, DSR_TYPE_LABELS, OPEN_STATUSES } from "./requests";

const TOO_MANY = "Too many requests. Please wait a while and try again.";
const PUBLIC_CONFIRM_HOURS = 48;

function failure(err: unknown): ActionResult<never> {
  if (err instanceof DataRequestError || err instanceof AuthzError) return { ok: false, error: err.message };
  logger.error({ err }, "privacy action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new AuthzError(401, "Please sign in again.");
  assertCan(user, "account.access");
  return user;
}

const refresh = () => revalidatePath("/account/privacy");

/** Access or portability: the worker builds the files and emails a link. */
export async function requestExportAction(): Promise<ActionResult> {
  try {
    const user = await signedIn();
    if (!(await rateLimit(`dsr:export:${user.id}`, 3, 24 * 3600)).allowed) return { ok: false, error: TOO_MANY };
    const meta = await requestMeta();
    const request = await withSystemContext(async (tx) => {
      const pending = await tx.dataSubjectRequest.findFirst({ where: { userId: user.id, type: { in: ["access", "portability"] }, status: { in: OPEN_STATUSES } } });
      if (pending) return pending;
      const r = await createDataRequest(tx, { type: "access", userId: user.id, email: user.email, name: user.name, channel: "privacy_centre", ipHash: meta.ipHash, verified: true });
      await writeAudit(tx, { actorUserId: user.id, action: "dsr.created", entityType: "data_subject_request", entityId: r.id, after: { type: r.type, reference: r.reference }, ipHash: meta.ipHash });
      return r;
    });
    await enqueueDataExport({ requestId: request.id });
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, message: "We're preparing your data. We'll email you when it's ready, usually within a few minutes." };
}

/** Rectification, restriction, objection, withdrawing consent or anything else: goes to TownMart's queue. */
export async function submitPrivacyRequestAction(input: z.input<typeof privacyRequestSchema>): Promise<ActionResult> {
  const parsed = privacyRequestSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const user = await signedIn();
    if (!(await rateLimit(`dsr:request:${user.id}`, 5, 24 * 3600)).allowed) return { ok: false, error: TOO_MANY };
    const meta = await requestMeta();
    const r = await withSystemContext(async (tx) => {
      const r = await createDataRequest(tx, { type: parsed.data.type, userId: user.id, email: user.email, name: user.name, details: parsed.data.details, channel: "privacy_centre", ipHash: meta.ipHash, verified: true });
      await writeAudit(tx, { actorUserId: user.id, action: "dsr.created", entityType: "data_subject_request", entityId: r.id, after: { type: r.type, reference: r.reference }, ipHash: meta.ipHash });
      return r;
    });
    await enqueueEmail(
      noticeTemplate({
        to: user.email,
        subject: `We've received your request · ${r.reference}`,
        title: "We've received your request",
        lines: [`Hi${user.name ? ` ${user.name}` : ""},`, `Your request (${DSR_TYPE_LABELS[r.type]}) is ${r.reference}. We'll reply by ${r.dueAt!.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "long" })}.`],
        url: new URL("/account/privacy", env().APP_URL).toString(),
        buttonLabel: "Open your Privacy Centre",
      }),
    );
    refresh();
    return { ok: true, message: `Request ${r.reference} sent. We'll reply by email.` };
  } catch (err) {
    return failure(err);
  }
}

/** Rectify: the name on the account. Email and phone have their own checked flows. */
export async function updateNameAction(input: z.input<typeof rectifyNameSchema>): Promise<ActionResult> {
  const parsed = rectifyNameSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const user = await signedIn();
    const meta = await requestMeta();
    await withRls({ userId: user.id }, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { name: parsed.data.name } });
      await writeAudit(tx, { actorUserId: user.id, action: "user.name_changed", entityType: "user", entityId: user.id, ipHash: meta.ipHash });
    });
  } catch (err) {
    return failure(err);
  }
  refresh();
  revalidatePath("/account");
  return { ok: true, message: "Your name is updated." };
}

/** Starts the grace period and signs the person out everywhere. */
export async function requestDeletionAction(input: z.input<typeof deletionSchema>): Promise<ActionResult> {
  const parsed = deletionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  let request;
  try {
    const user = await signedIn();
    const meta = await requestMeta();
    request = await withSystemContext((tx) => requestAccountDeletion(tx, { userId: user.id, reason: parsed.data.reason, ipHash: meta.ipHash }));
    await enqueueEmail(
      noticeTemplate({
        to: user.email,
        subject: `Your TownMart account will be deleted · ${request.reference}`,
        title: "Your account will be deleted",
        lines: [
          `Hi${user.name ? ` ${user.name}` : ""},`,
          `We'll delete your account on ${request.dueAt!.toLocaleDateString("en-NG", { timeZone: "Africa/Lagos", dateStyle: "long" })}. Until then you can change your mind: just sign in again and the deletion is cancelled.`,
          "We keep order, payment and refund records for six years because tax and accounting law requires it. They won't be linked to a sign-in.",
        ],
        url: new URL("/auth/sign-in", env().APP_URL).toString(),
        buttonLabel: "Changed your mind? Sign in",
      }),
    );
  } catch (err) {
    return failure(err);
  }
  await destroyCurrentSession();
  redirect("/?account=deleting");
}

// ─── Public form (no account) ───────────────────────────────────────────────

export async function publicDataRequestAction(input: z.input<typeof publicDataRequestSchema>): Promise<ActionResult> {
  const parsed = publicDataRequestSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { name, email, type, details, turnstileToken } = parsed.data;
  const meta = await requestMeta();
  const [byIp, byEmail] = await Promise.all([rateLimit(`dsr:public:ip:${meta.ipHash}`, 5, 3600), rateLimit(`dsr:public:email:${email}`, 3, 24 * 3600)]);
  if (!byIp.allowed || !byEmail.allowed) return { ok: false, error: TOO_MANY };
  if (!(await verifyTurnstile(turnstileToken, meta.ip))) return { ok: false, error: "Please complete the check to show you're not a robot." };

  try {
    const r = await withSystemContext((tx) => createDataRequest(tx, { type, userId: null, email, name, details, channel: "public_form", ipHash: meta.ipHash, verified: false }));
    const token = await issueToken(tokenIdentifier.dataRequest(r.id), PUBLIC_CONFIRM_HOURS * 3600_000);
    const url = new URL("/legal/data-request/confirm", env().APP_URL);
    url.searchParams.set("id", r.id);
    url.searchParams.set("token", token);
    await enqueueEmail(
      noticeTemplate({
        to: email,
        subject: `Confirm your data request · ${r.reference}`,
        title: "Confirm your data request",
        lines: [`Hi ${name},`, `Please confirm it was you who asked: ${DSR_TYPE_LABELS[type]}. We start work, and the deadline starts, once you confirm. The link works for ${PUBLIC_CONFIRM_HOURS} hours.`],
        url: url.toString(),
        buttonLabel: "Confirm my request",
      }),
    );
  } catch (err) {
    return failure(err);
  }
  // The answer never says whether the address has an account.
  return { ok: true, message: "Check your email: we've sent a link to confirm your request." };
}
