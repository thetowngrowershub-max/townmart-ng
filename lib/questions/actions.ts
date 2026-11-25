"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError } from "@/lib/authz";
import { withRls, withSystemContext } from "@/lib/db";
import { env } from "@/lib/env";
import { sellerSelect, tellSeller } from "@/lib/fulfilment/notify";
import { logger } from "@/lib/logger";
import { noticeTemplate } from "@/lib/notifications/email/templates";
import { enqueueEmail } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { shortName } from "@/lib/reviews/reviews";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { answerQuestionSchema, askQuestionSchema } from "@/lib/validation/moderation";

/**
 * Questions and answers on listings. Signed-in shoppers ask; the shop (owner,
 * or staff who handle reviews) answers, and the answer makes the question
 * public. Each side is told by email and in-app.
 */

class QuestionError extends Error {}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof QuestionError) return { ok: false, error: err.message };
  logger.error({ err }, "question action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

export async function askQuestionAction(input: z.input<typeof askQuestionSchema>): Promise<ActionResult> {
  const parsed = askQuestionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to ask a question." };
  if (!(await rateLimit(`question:${user.id}`, 10, 3600)).allowed) return { ok: false, error: "You've asked a lot of questions just now. Please try again later." };
  const { kind, id, question } = parsed.data;
  try {
    const q = await withRls({ userId: user.id }, async (tx) => {
      const listing = kind === "product" ? await tx.product.findUnique({ where: { id }, select: { businessId: true, title: true } }) : await tx.service.findUnique({ where: { id }, select: { businessId: true, title: true } });
      if (!listing) throw new QuestionError("We couldn't find that listing.");
      const created = await tx.listingQuestion.create({
        data: { ...(kind === "product" ? { productId: id } : { serviceId: id }), businessId: listing.businessId, askerUserId: user.id, askerName: shortName(user.name), question },
        select: { id: true },
      });
      return { ...created, listing };
    });
    try {
      await withSystemContext(async (tx) => {
        const business = await tx.business.findUniqueOrThrow({ where: { id: q.listing.businessId }, select: sellerSelect });
        await tellSeller(tx, business, { type: "question.new", title: `New question about “${q.listing.title}”`, lines: [`A shopper asked: “${question}”`, "Answer it from your dashboard; the answer is shown on the listing."], path: "/dashboard/questions" });
      });
    } catch (err) {
      logger.error({ err }, "could not tell the seller about a question");
    }
    return { ok: true, message: "Question sent. We'll email you when the seller answers, and it'll appear here." };
  } catch (err) {
    return failure(err);
  }
}

export async function answerQuestionAction(input: z.input<typeof answerQuestionSchema>): Promise<ActionResult> {
  const parsed = answerQuestionSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await getSellerContext();
    if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
    assertCan(ctx.user, "question.answer", { businessId: ctx.business.id });
    const q = await withSellerRls(ctx, async (tx) => {
      const q = await tx.listingQuestion.findUnique({
        where: { id: parsed.data.id },
        select: { id: true, businessId: true, answer: true, question: true, askerUserId: true, product: { select: { title: true, slug: true } }, service: { select: { title: true, slug: true } } },
      });
      if (!q || q.businessId !== ctx.business.id) throw new QuestionError("Question not found.");
      await tx.listingQuestion.update({ where: { id: q.id }, data: { answer: parsed.data.answer, answeredBy: ctx.user.id, answeredAt: new Date() } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: q.answer ? "question.answer_edited" : "question.answered", entityType: "listing_question", entityId: q.id });
      return q;
    });
    const path = q.product ? `/p/${q.product.slug}` : `/s/${q.service!.slug}`;
    if (!q.answer && q.askerUserId) {
      try {
        await withSystemContext(async (tx) => {
          const asker = await tx.user.findUnique({ where: { id: q.askerUserId! }, select: { email: true, name: true, status: true } });
          if (!asker || asker.status !== "active") return;
          const title = q.product?.title ?? q.service!.title;
          await enqueueEmail(noticeTemplate({ to: asker.email, subject: `Your question about “${title}” has an answer`, title: "The seller answered your question", lines: [`You asked: “${q.question}”`, `They said: “${parsed.data.answer}”`], url: `${env().APP_URL}${path}`, buttonLabel: "See the listing" }));
          await tx.notification.create({ data: { userId: q.askerUserId!, type: "question.answered", title: `Answer about “${title}”`, body: parsed.data.answer.slice(0, 200), link: path } });
        });
      } catch (err) {
        logger.error({ err }, "could not tell the shopper about an answer");
      }
    }
    revalidatePath(path);
    revalidatePath("/dashboard/questions");
    return { ok: true, message: "Answer published on the listing." };
  } catch (err) {
    return failure(err);
  }
}
