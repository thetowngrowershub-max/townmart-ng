"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { adminContext, adminFailure } from "@/lib/admin/context";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withRls, withSystemContext } from "@/lib/db";
import { tellSeller, sellerSelect } from "@/lib/fulfilment/notify";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { dismissSchema, keywordsSchema, listingRefSchema, questionModerationSchema, reportListingSchema, reviewModerationSchema, takeDownSchema } from "@/lib/validation/moderation";
import { dismissReports, ModerationError, restoreListing, takeDownListing, type ListingRef } from "./core";
import { KEYWORDS_SETTING, parseKeywords } from "./keywords";

/**
 * Moderation: shoppers report listings; TownMart takes listings down or
 * restores them, dismisses reports, hides reviews and questions, and keeps
 * the prohibited-items keyword list. Every admin decision is audited and the
 * seller is told about take-downs and restores.
 */

function failure(err: unknown): ActionResult<never> {
  if (err instanceof ModerationError) return { ok: false, error: err.message };
  return adminFailure(err, "moderation action");
}

const refresh = () => revalidatePath("/admin/moderation", "layout");
const listingPath = (ref: ListingRef, slug: string) => (ref.kind === "product" ? `/p/${slug}` : `/s/${slug}`);
const dashboardPath = (ref: ListingRef) => (ref.kind === "product" ? `/dashboard/products/${ref.id}` : `/dashboard/services/${ref.id}`);

async function tellShop(businessId: string, p: { type: string; title: string; lines: string[]; path: string }) {
  try {
    await withSystemContext(async (tx) => {
      const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: sellerSelect });
      await tellSeller(tx, business, p);
    });
  } catch (err) {
    logger.error({ err, businessId }, "could not tell the seller about a moderation decision");
  }
}

// ─── Shoppers ───────────────────────────────────────────────────────────────

export async function reportListingAction(input: z.input<typeof reportListingSchema>): Promise<ActionResult> {
  const parsed = reportListingSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to report a listing." };
  const meta = await requestMeta();
  if (!(await rateLimit(`listing-report:${user.id}`, 10, 3600)).allowed) return { ok: false, error: "Too many reports. Please try again later." };
  const { kind, id, reason, details } = parsed.data;
  try {
    await withRls({ userId: user.id }, async (tx) => {
      // Only listings the shopper can see can be reported (RLS hides the rest).
      const listing = kind === "product" ? await tx.product.findUnique({ where: { id }, select: { businessId: true } }) : await tx.service.findUnique({ where: { id }, select: { businessId: true } });
      if (!listing) throw new ModerationError("We couldn't find that listing.");
      await tx.listingReport.create({
        data: { ...(kind === "product" ? { productId: id } : { serviceId: id }), businessId: listing.businessId, reporterUserId: user.id, reason, details: details || null, ipHash: meta.ipHash },
      });
    });
    return { ok: true, message: "Thanks for telling us. Our team will review this listing." };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: true, message: "You've already reported this listing. Our team will review it." };
    if (err instanceof ModerationError) return { ok: false, error: err.message };
    logger.error({ err }, "reporting a listing failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}

// ─── TownMart ───────────────────────────────────────────────────────────────

export async function takeDownListingAction(input: z.input<typeof takeDownSchema>): Promise<ActionResult> {
  const parsed = takeDownSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { kind, id, reason } = parsed.data;
  try {
    const { actor, run } = await adminContext("moderation.manage");
    const res = await run(async (tx, audit) => {
      const r = await takeDownListing(tx, { kind, id }, { reason, actorUserId: actor.id });
      await audit("listing.taken_down", kind, id, { reason, reportsClosed: r.reportsClosed });
      return r;
    });
    await tellShop(res.listing.businessId, {
      type: "listing.taken_down",
      title: `“${res.listing.title}” has been taken down`,
      lines: [`TownMart has taken your listing “${res.listing.title}” off the marketplace. Shoppers can't see or buy it.`, `Why: ${reason}`, "If you think this is a mistake, or once you've fixed it, reply to this email or contact support and we'll look again."],
      path: dashboardPath({ kind, id }),
    });
    refresh();
    revalidatePath(listingPath({ kind, id }, res.listing.slug));
    return { ok: true, message: "Listing taken down and the seller told." };
  } catch (err) {
    return failure(err);
  }
}

export async function restoreListingAction(input: z.input<typeof listingRefSchema>): Promise<ActionResult> {
  const parsed = listingRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const ref = parsed.data;
  try {
    const { run } = await adminContext("moderation.manage");
    const res = await run(async (tx, audit) => {
      const r = await restoreListing(tx, ref);
      await audit("listing.restored", ref.kind, ref.id, null, { reason: r.listing.takenDownReason });
      return r;
    });
    await tellShop(res.listing.businessId, {
      type: "listing.restored",
      title: `“${res.listing.title}” is back on TownMart`,
      lines: [`We've restored your listing “${res.listing.title}”.`, res.listing.status === "active" ? "Shoppers can see and buy it again." : "It's still a draft or archived in your dashboard; publish it when you're ready."],
      path: dashboardPath(ref),
    });
    refresh();
    revalidatePath(listingPath(ref, res.listing.slug));
    return { ok: true, message: "Listing restored and the seller told." };
  } catch (err) {
    return failure(err);
  }
}

export async function dismissReportsAction(input: z.input<typeof dismissSchema>): Promise<ActionResult> {
  const parsed = dismissSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { kind, id, note } = parsed.data;
  try {
    const { actor, run } = await adminContext("moderation.manage");
    const n = await run(async (tx, audit) => {
      const n = await dismissReports(tx, { kind, id }, { note, actorUserId: actor.id });
      await audit("listing.reports_dismissed", kind, id, { note, reports: n });
      return n;
    });
    refresh();
    return { ok: true, message: `${n} report${n === 1 ? "" : "s"} dismissed. The listing stays live.` };
  } catch (err) {
    return failure(err);
  }
}

export async function moderateReviewAction(input: z.input<typeof reviewModerationSchema>): Promise<ActionResult> {
  const parsed = reviewModerationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, action } = parsed.data;
  try {
    const { run } = await adminContext("moderation.manage");
    const review = await run(async (tx, audit) => {
      const before = await tx.review.findUnique({ where: { id }, select: { status: true, productId: true, serviceId: true, businessId: true } });
      if (!before) throw new ModerationError("Review not found.");
      const status = action === "hide" ? "hidden" : "published";
      if (before.status === status) throw new ModerationError(action === "hide" ? "This review is already hidden." : "This review is already shown.");
      await tx.review.update({ where: { id }, data: { status, reportReason: null, reportedAt: null } });
      await tx.$executeRaw`SELECT refresh_ratings(${before.businessId}::uuid, ${before.productId}::uuid, ${before.serviceId}::uuid)`;
      await audit(action === "hide" ? "review.hidden" : "review.published", "review", id, { status }, { status: before.status });
      return before;
    });
    refresh();
    revalidatePath(review.productId ? "/p/[slug]" : "/s/[slug]", "page");
    return { ok: true, message: action === "hide" ? "Review hidden. Ratings updated." : "Review shown again." };
  } catch (err) {
    return failure(err);
  }
}

export async function moderateQuestionAction(input: z.input<typeof questionModerationSchema>): Promise<ActionResult> {
  const parsed = questionModerationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, action } = parsed.data;
  try {
    const { run } = await adminContext("moderation.manage");
    await run(async (tx, audit) => {
      const status = action === "hide" ? "hidden" : "published";
      const { count } = await tx.listingQuestion.updateMany({ where: { id, status: { not: status } }, data: { status } });
      if (count === 0) throw new ModerationError("Nothing to change.");
      await audit(action === "hide" ? "question.hidden" : "question.published", "listing_question", id, { status });
    });
    refresh();
    return { ok: true, message: action === "hide" ? "Question hidden." : "Question shown again." };
  } catch (err) {
    return failure(err);
  }
}

export async function saveKeywordsAction(input: z.input<typeof keywordsSchema>): Promise<ActionResult<{ count: number }>> {
  const parsed = keywordsSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const keywords = parseKeywords(parsed.data.text);
  try {
    const { actor, run } = await adminContext("moderation.manage");
    await run(async (tx, audit) => {
      const before = await tx.setting.findUnique({ where: { key: KEYWORDS_SETTING } });
      await tx.setting.upsert({
        where: { key: KEYWORDS_SETTING },
        create: { key: KEYWORDS_SETTING, value: keywords, description: "Words and phrases that flag a listing for review", updatedBy: actor.id },
        update: { value: keywords, updatedBy: actor.id },
      });
      await audit("settings.updated", "setting", KEYWORDS_SETTING, { count: keywords.length }, before ? { count: (before.value as unknown[]).length } : null);
    });
    refresh();
    return { ok: true, data: { count: keywords.length }, message: `Saved ${keywords.length} keywords. New and edited listings are checked against them.` };
  } catch (err) {
    return failure(err);
  }
}
