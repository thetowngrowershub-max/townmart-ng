"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError } from "@/lib/authz";
import { withRls, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { isLegalSlug, nextVersion } from "@/lib/legal/documents";
import { COMPANY_KEYS } from "@/lib/legal/company";
import { logger } from "@/lib/logger";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { DSR_TYPE_LABELS } from "@/lib/privacy/labels";
import { enqueueDataExport, enqueueEmail } from "@/lib/queue";
import { requestMeta } from "@/lib/request";
import { sanitizeRichText } from "@/lib/sanitize";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { activitySchema, breachSchema, companySchema, dpiaSchema, dsrUpdateSchema, legalPublishSchema, processorSchema, retentionSchema } from "@/lib/validation/compliance";
import { RETENTION_DEFAULTS, RETENTION_KEYS } from "./retention";

/**
 * The compliance centre's writes. Admin scope (privileged under RLS) after
 * the `compliance.manage` check; every change goes to the audit log.
 */

class ComplianceError extends Error {}

async function admin() {
  const actor = await getCurrentUser();
  assertCan(actor, "compliance.manage");
  const meta = await requestMeta();
  const role = actor.roles.includes("super_admin") ? "super_admin" : "admin";
  const run = <T,>(fn: (tx: Tx, audit: (action: string, entityType: string, entityId: string | null, after?: unknown, before?: unknown) => Promise<void>) => Promise<T>) =>
    withRls({ scope: "admin", userId: actor.id }, (tx) =>
      fn(tx, (action, entityType, entityId, after, before) => writeAudit(tx, { actorUserId: actor.id, actorRole: role, action, entityType, entityId, after, before, ipHash: meta.ipHash })),
    );
  return { actor, run };
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof ComplianceError) return { ok: false, error: err.message };
  logger.error({ err }, "compliance action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

const refresh = (path: string) => revalidatePath(`/admin/compliance${path}`, "layout");

// ─── Data subject requests ──────────────────────────────────────────────────

export async function updateDataRequestAction(input: z.input<typeof dsrUpdateSchema>): Promise<ActionResult> {
  const parsed = dsrUpdateSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, status, note } = parsed.data;
  try {
    const { actor, run } = await admin();
    const r = await run(async (tx, audit) => {
      const r = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id } });
      if (!["open", "in_progress"].includes(r.status)) throw new ComplianceError("This request is already closed.");
      if (status !== "in_progress" && !note) throw new ComplianceError("Add a note for the requester saying what you did.");
      const updated = await tx.dataSubjectRequest.update({
        where: { id },
        data: { status, assignedTo: r.assignedTo ?? actor.id, resolutionNote: note || r.resolutionNote, completedAt: status === "in_progress" ? null : new Date() },
      });
      await audit("dsr.updated", "data_subject_request", id, { status, note }, { status: r.status });
      return updated;
    });
    // The requester is told when their request is finished.
    if (status !== "in_progress") {
      await enqueueEmail(
        noticeTemplate({
          to: r.email,
          subject: `Your data request ${r.reference} is ${status === "completed" ? "done" : "closed"}`,
          title: status === "completed" ? "We've dealt with your request" : "About your data request",
          lines: [`Hi${r.name ? ` ${r.name}` : ""},`, `Your request (${DSR_TYPE_LABELS[r.type]}, ${r.reference}):`, note!, "If you're not happy with our answer you can complain to the Nigeria Data Protection Commission."],
          url: new URL(r.userId ? "/account/privacy" : "/legal/privacy", env().APP_URL).toString(),
          buttonLabel: r.userId ? "Open your Privacy Centre" : "Read our Privacy Policy",
        }),
      );
    }
  } catch (err) {
    return failure(err);
  }
  refresh("/requests");
  return { ok: true, message: status === "in_progress" ? "Marked as in progress." : "Closed, and the requester has been emailed." };
}

/** For an access or portability request from someone with an account: the same export the Privacy Centre makes. */
export async function prepareExportAction(input: { id: string }): Promise<ActionResult> {
  try {
    const { run } = await admin();
    await run(async (tx, audit) => {
      const r = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: input.id } });
      if (!r.userId) throw new ComplianceError("No TownMart account matches this request, so there's nothing to export automatically.");
      if (!["access", "portability"].includes(r.type) || !["open", "in_progress"].includes(r.status)) throw new ComplianceError("Only open access or portability requests can be exported.");
      await tx.dataSubjectRequest.update({ where: { id: r.id }, data: { status: "in_progress" } });
      await audit("dsr.export_started", "data_subject_request", r.id);
    });
    await enqueueDataExport({ requestId: input.id });
  } catch (err) {
    return failure(err);
  }
  refresh("/requests");
  return { ok: true, message: "The export is being prepared; the requester gets an email with the link." };
}

/** Links a public-form request to the account with the same, now confirmed, email address. */
export async function linkRequestToAccountAction(input: { id: string }): Promise<ActionResult> {
  try {
    const { run } = await admin();
    await run(async (tx, audit) => {
      const r = await tx.dataSubjectRequest.findUniqueOrThrow({ where: { id: input.id } });
      if (r.userId) throw new ComplianceError("This request is already linked to an account.");
      if (!r.verifiedAt) throw new ComplianceError("The requester hasn't confirmed their email yet.");
      const user = await tx.user.findUnique({ where: { email: r.email }, select: { id: true } });
      if (!user) throw new ComplianceError("No account uses this email address.");
      await tx.dataSubjectRequest.update({ where: { id: r.id }, data: { userId: user.id } });
      await audit("dsr.linked", "data_subject_request", r.id, { userId: user.id });
    });
  } catch (err) {
    return failure(err);
  }
  refresh("/requests");
  return { ok: true, message: "Linked to the account." };
}

// ─── Breach register ────────────────────────────────────────────────────────

export async function saveBreachAction(input: z.input<typeof breachSchema>): Promise<ActionResult<{ id: string }>> {
  const parsed = breachSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  try {
    const { actor, run } = await admin();
    const saved = await run(async (tx, audit) => {
      if (id) {
        const before = await tx.breachIncident.findUniqueOrThrow({ where: { id } });
        const b = await tx.breachIncident.update({ where: { id }, data: { ...d, closedAt: d.status === "closed" ? (before.closedAt ?? new Date()) : null } });
        await audit("breach.updated", "breach_incident", id, d, before);
        return b;
      }
      const reference = (await tx.$queryRaw<{ r: string }[]>`SELECT next_breach_reference() AS r`)[0]!.r;
      const b = await tx.breachIncident.create({ data: { ...d, reference, createdBy: actor.id, closedAt: d.status === "closed" ? new Date() : null } });
      await audit("breach.logged", "breach_incident", b.id, d);
      return b;
    });
    refresh("/breaches");
    return { ok: true, data: { id: saved.id }, message: id ? "Saved." : `Logged as ${saved.reference}.` };
  } catch (err) {
    return failure(err);
  }
}

// ─── RoPA, processors and DPIAs ─────────────────────────────────────────────

export async function saveActivityAction(input: z.input<typeof activitySchema>): Promise<ActionResult> {
  const parsed = activitySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  try {
    const { run } = await admin();
    await run(async (tx, audit) => {
      const a = id ? await tx.processingActivity.update({ where: { id }, data: d }) : await tx.processingActivity.create({ data: { ...d, sortOrder: await tx.processingActivity.count() } });
      await audit(id ? "ropa.updated" : "ropa.created", "processing_activity", a.id, d);
    });
  } catch (err) {
    return failure(err);
  }
  refresh("/records");
  return { ok: true, message: "Saved." };
}

export async function saveProcessorAction(input: z.input<typeof processorSchema>): Promise<ActionResult> {
  const parsed = processorSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  try {
    const { run } = await admin();
    await run(async (tx, audit) => {
      const p = id ? await tx.dataProcessor.update({ where: { id }, data: d }) : await tx.dataProcessor.create({ data: d });
      await audit(id ? "processor.updated" : "processor.created", "data_processor", p.id, d);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, error: "A processor with this name already exists.", fieldErrors: { name: ["Already listed"] } };
    return failure(err);
  }
  refresh("/records");
  return { ok: true, message: "Saved." };
}

export async function saveDpiaAction(input: z.input<typeof dpiaSchema>): Promise<ActionResult> {
  const parsed = dpiaSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, ...d } = parsed.data;
  try {
    const { run } = await admin();
    await run(async (tx, audit) => {
      const data = { ...d, reviewedAt: d.status === "approved" ? new Date() : undefined };
      const r = id ? await tx.dpiaRecord.update({ where: { id }, data }) : await tx.dpiaRecord.create({ data });
      await audit(id ? "dpia.updated" : "dpia.created", "dpia_record", r.id, d);
    });
  } catch (err) {
    return failure(err);
  }
  refresh("/records");
  return { ok: true, message: "Saved." };
}

// ─── Retention ──────────────────────────────────────────────────────────────

export async function saveRetentionAction(input: Record<string, string | number>): Promise<ActionResult> {
  const parsed = retentionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await admin();
    await run(async (tx, audit) => {
      const before = Object.fromEntries((await tx.retentionSetting.findMany()).map((r) => [r.key, r.days]));
      for (const key of RETENTION_KEYS) {
        const days = parsed.data[key] as number;
        await tx.retentionSetting.upsert({ where: { key }, create: { key, ...RETENTION_DEFAULTS[key], days, updatedBy: actor.id }, update: { days, updatedBy: actor.id } });
      }
      await audit("retention.updated", "retention_settings", null, parsed.data, before);
    });
  } catch (err) {
    return failure(err);
  }
  refresh("/retention");
  return { ok: true, message: "Saved. The retention jobs use the new periods from their next run." };
}

// ─── Legal pages ────────────────────────────────────────────────────────────

/** Publishes a new version. Old versions are kept; the new one applies from its effective date. */
export async function publishLegalDocumentAction(input: z.input<typeof legalPublishSchema>): Promise<ActionResult<{ version: string }>> {
  const parsed = legalPublishSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  if (!isLegalSlug(d.slug)) return { ok: false, error: "Unknown page." };
  const bodyHtml = sanitizeRichText(d.bodyHtml);
  if (!bodyHtml) return { ok: false, error: "The page can't be empty.", fieldErrors: { bodyHtml: ["The page can't be empty"] } };
  try {
    const { actor, run } = await admin();
    const version = await run(async (tx, audit) => {
      // Serialise publishes of the same page so two editors can't take the same version label.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal:${d.slug}`}))`;
      const existing = (await tx.legalDocument.findMany({ where: { slug: d.slug }, select: { version: true } })).map((r) => r.version);
      const version = nextVersion(existing, d.effectiveAt);
      const doc = await tx.legalDocument.create({
        data: { slug: d.slug, version, title: d.title, summary: d.summary, bodyHtml, effectiveAt: d.effectiveAt, changeNote: d.changeNote, isTemplate: d.isTemplate, publishedBy: actor.id },
      });
      await audit("legal.published", "legal_document", doc.id, { slug: d.slug, version, effectiveAt: d.effectiveAt, changeNote: d.changeNote, isTemplate: d.isTemplate });
      return version;
    });
    revalidatePath(`/legal/${d.slug}`);
    refresh("/legal");
    return { ok: true, data: { version }, message: `Published version ${version}.` };
  } catch (err) {
    return failure(err);
  }
}

export async function saveCompanyDetailsAction(input: Record<string, string>): Promise<ActionResult> {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await admin();
    await run(async (tx, audit) => {
      for (const k of COMPANY_KEYS) {
        const key = `company.${k}`;
        const value = parsed.data[k];
        if (value) await tx.setting.upsert({ where: { key }, create: { key, value, description: "Shown in the legal pages", updatedBy: actor.id }, update: { value, updatedBy: actor.id } });
        else await tx.setting.deleteMany({ where: { key } });
      }
      await audit("company_details.updated", "settings", null, parsed.data);
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/legal", "layout");
  refresh("/legal");
  return { ok: true, message: "Saved. Every legal page shows the new details straight away." };
}
