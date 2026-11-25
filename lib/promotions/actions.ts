"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { assertCan, AuthzError } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { promotionChangeSchema as changeSchema, promotionIdSchema, promotionInputSchema, type PromotionInput } from "@/lib/validation/promotions";
import { changeLabel, changePromotion, deletePromotion, PromotionError, savePromotion } from "./promotions";

async function promoter(): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, "promotion.manage", { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError) return { ok: false, error: err.message };
  if (err instanceof PromotionError) {
    return { ok: false, error: err.message, fieldErrors: err.field ? { [err.field]: [err.message] } : undefined };
  }
  logger.error({ err }, "promotion action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

function revalidateStorefront() {
  // Discounts show on cards everywhere; refresh the dashboard and the public pages that list deals.
  revalidatePath("/dashboard/promotions");
  revalidatePath("/deals");
  revalidatePath("/");
}

export async function savePromotionAction(promotionId: string | null, input: PromotionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = promotionInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (promotionId !== null && !promotionIdSchema.safeParse(promotionId).success) return { ok: false, error: "Promotion not found." };
  try {
    const ctx = await promoter();
    const res = await withSellerRls(ctx, async (tx) => {
      const before = promotionId
        ? await tx.promotion.findFirst({ where: { id: promotionId, businessId: ctx.business.id }, select: { name: true, discountType: true, discountValue: true, startsAt: true, endsAt: true, isActive: true } })
        : null;
      const r = await savePromotion(tx, { businessId: ctx.business.id, actorUserId: ctx.user.id, data: parsed.data, promotionId: promotionId ?? undefined });
      await writeAudit(tx, {
        actorUserId: ctx.user.id,
        action: promotionId ? "promotion.updated" : "promotion.created",
        entityType: "promotion",
        entityId: r.id,
        before: before ? { ...before, discountValue: before.discountValue.toString() } : undefined,
        after: {
          name: parsed.data.name,
          discountType: parsed.data.discountType,
          discountValue: parsed.data.discountValue.toString(),
          scope: parsed.data.scope,
          startsAt: parsed.data.startsAt,
          endsAt: parsed.data.endsAt,
          isActive: parsed.data.isActive,
          coupon: parsed.data.couponCode !== null,
        },
      });
      return r;
    });
    revalidateStorefront();
    return { ok: true, data: res, message: "Promotion saved." };
  } catch (err) {
    return failure(err);
  }
}


export async function changePromotionAction(input: z.input<typeof changeSchema>): Promise<ActionResult> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Promotion not found." };
  const { id, change } = parsed.data;
  try {
    const ctx = await promoter();
    await withSellerRls(ctx, async (tx) => {
      await changePromotion(tx, ctx.business.id, id, change);
      await writeAudit(tx, { actorUserId: ctx.user.id, action: `promotion.${changeLabel(change)}`, entityType: "promotion", entityId: id });
    });
    revalidateStorefront();
    return { ok: true, message: change === "end" ? "Promotion ended." : change === "pause" ? "Promotion paused." : "Promotion resumed." };
  } catch (err) {
    return failure(err);
  }
}

export async function deletePromotionAction(id: string): Promise<ActionResult> {
  if (!promotionIdSchema.safeParse(id).success) return { ok: false, error: "Promotion not found." };
  try {
    const ctx = await promoter();
    await withSellerRls(ctx, async (tx) => {
      const p = await deletePromotion(tx, ctx.business.id, id);
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "promotion.deleted", entityType: "promotion", entityId: id, before: p });
    });
    revalidateStorefront();
    return { ok: true, message: "Promotion deleted." };
  } catch (err) {
    return failure(err);
  }
}
