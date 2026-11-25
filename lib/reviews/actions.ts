"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError } from "@/lib/authz";
import { withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { reviewReplySchema, reviewReportSchema, reviewSchema } from "@/lib/validation/fulfilment";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { ReviewError, writeReview } from "./reviews";

function failure(err: unknown): ActionResult<never> {
  if (err instanceof ReviewError || err instanceof AuthzError) return { ok: false, error: err.message };
  logger.error({ err }, "review action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** A verified buyer reviews an item they received (or a booking that was done). */
export async function writeReviewAction(input: { orderItemId: string; rating: number; body: string; imageKeys?: string[] }): Promise<ActionResult<{ href: string }>> {
  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to write a review." };
  if (!(await rateLimit(`review:${user.id}`, 10, 3600)).allowed) return { ok: false, error: "You've written a lot of reviews just now. Please try again later." };
  try {
    const { target } = await withSystemContext((tx) => writeReview(tx, { userId: user.id, userName: user.name, ...parsed.data }));
    const href = target.kind === "service" ? `/s/${target.slug}` : `/p/${target.slug}`;
    revalidatePath(href);
    revalidatePath("/account/reviews");
    return { ok: true, data: { href }, message: "Thanks! Your review is live." };
  } catch (err) {
    // A second submit for the same item hits the unique index.
    if (err instanceof Error && /Unique constraint/.test(err.message)) return { ok: false, error: "You've already reviewed this." };
    return failure(err);
  }
}

/** The seller answers a review publicly (once; they can edit the reply). Seller RLS: the trigger stops them changing anything else. */
export async function replyToReviewAction(input: { reviewId: string; reply: string }): Promise<ActionResult> {
  const parsed = reviewReplySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await getSellerContext();
    if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
    assertCan(ctx.user, "review.manage", { businessId: ctx.business.id });
    const n = await withSellerRls(ctx, (tx) =>
      tx.review.updateMany({ where: { id: parsed.data.reviewId, businessId: ctx.business.id }, data: { sellerReply: parsed.data.reply, sellerRepliedAt: new Date() } }),
    );
    if (n.count === 0) return { ok: false, error: "Review not found." };
    revalidatePath("/dashboard/reviews");
    return { ok: true, message: "Reply posted." };
  } catch (err) {
    return failure(err);
  }
}

/** Anyone signed in can report a review for moderation (Phase 7 adds the moderation queue). */
export async function reportReviewAction(input: { reviewId: string; reason: string }): Promise<ActionResult> {
  const parsed = reviewReportSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to report a review." };
  if (!(await rateLimit(`review-report:${user.id}`, 10, 3600)).allowed) return { ok: false, error: "Too many reports. Please try again later." };
  try {
    await withSystemContext((tx) =>
      tx.review.updateMany({ where: { id: parsed.data.reviewId, status: "published" }, data: { status: "reported", reportReason: `${parsed.data.reason} (reported by ${user.id})`, reportedAt: new Date() } }),
    );
    return { ok: true, message: "Thanks. Our team will take a look." };
  } catch (err) {
    return failure(err);
  }
}
