"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { adminContext, AdminError, adminFailure } from "@/lib/admin/context";
import { changeLabel, changePromotion, deletePromotion, PromotionError, savePromotion } from "@/lib/promotions/promotions";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { promotionChangeSchema, promotionIdSchema, promotionInputSchema, type PromotionInput } from "@/lib/validation/promotions";

/**
 * TownMart's own promotions: platform-wide (business_id NULL), on everything
 * or on whole categories, funded by TownMart rather than sellers. Only admin
 * scope can write them under RLS.
 */

function failure(err: unknown): ActionResult<never> {
  if (err instanceof PromotionError) return { ok: false, error: err.message, fieldErrors: err.field ? { [err.field]: [err.message] } : undefined };
  return adminFailure(err, "platform promotion action");
}

function refresh() {
  revalidatePath("/admin/catalogue/promotions", "layout");
  revalidatePath("/deals");
  revalidatePath("/", "layout");
}

export async function savePlatformPromotionAction(promotionId: string | null, input: PromotionInput): Promise<ActionResult<{ id: string }>> {
  const parsed = promotionInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (promotionId !== null && !promotionIdSchema.safeParse(promotionId).success) return { ok: false, error: "Promotion not found." };
  const data = parsed.data;
  if (data.scope !== "store" && data.scope !== "category") return { ok: false, error: "TownMart promotions cover everything or whole categories.", fieldErrors: { scope: ["Choose everything or a category"] } };
  try {
    const { actor, run } = await adminContext("settings.manage");
    const res = await run(async (tx, audit) => {
      if (promotionId && !(await tx.promotion.count({ where: { id: promotionId, businessId: null } }))) throw new AdminError("Promotion not found.");
      const r = await savePromotion(tx, { businessId: null, actorUserId: actor.id, data, promotionId: promotionId ?? undefined });
      await audit(promotionId ? "promotion.updated" : "promotion.created", "promotion", r.id, {
        platform: true,
        name: data.name,
        discountType: data.discountType,
        discountValue: data.discountValue.toString(),
        scope: data.scope,
        startsAt: data.startsAt,
        endsAt: data.endsAt,
        isActive: data.isActive,
        coupon: data.couponCode !== null,
      });
      return r;
    });
    refresh();
    return { ok: true, data: res, message: "Promotion saved." };
  } catch (err) {
    return failure(err);
  }
}

export async function changePlatformPromotionAction(input: z.input<typeof promotionChangeSchema>): Promise<ActionResult> {
  const parsed = promotionChangeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Promotion not found." };
  const { id, change } = parsed.data;
  try {
    const { run } = await adminContext("settings.manage");
    await run(async (tx, audit) => {
      await changePromotion(tx, null, id, change);
      await audit(`promotion.${changeLabel(change)}`, "promotion", id, { platform: true });
    });
    refresh();
    return { ok: true, message: change === "end" ? "Promotion ended." : change === "pause" ? "Promotion paused." : "Promotion resumed." };
  } catch (err) {
    return failure(err);
  }
}

export async function deletePlatformPromotionAction(id: string): Promise<ActionResult> {
  if (!promotionIdSchema.safeParse(id).success) return { ok: false, error: "Promotion not found." };
  try {
    const { run } = await adminContext("settings.manage");
    await run(async (tx, audit) => {
      const p = await deletePromotion(tx, null, id);
      await audit("promotion.deleted", "promotion", id, null, { ...p, platform: true });
    });
    refresh();
    return { ok: true, message: "Promotion deleted." };
  } catch (err) {
    return failure(err);
  }
}
