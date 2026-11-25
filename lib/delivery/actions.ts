"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCan, AuthzError } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { zoneRatesSchema, type ZoneRatesInput } from "@/lib/validation/delivery-rates";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

async function seller() {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, "store.manage", { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError) return { ok: false, error: err.message };
  logger.error({ err }, "delivery rates action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Replaces the seller's own bands for a zone. Seller RLS: rows can only carry their business id. */
export async function saveZoneRatesAction(input: ZoneRatesInput): Promise<ActionResult> {
  const parsed = zoneRatesSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller();
    const { zoneId, bands } = parsed.data;
    await withSellerRls(ctx, async (tx) => {
      await tx.deliveryZone.findFirstOrThrow({ where: { id: zoneId, isActive: true }, select: { id: true } });
      await tx.deliveryRate.deleteMany({ where: { zoneId, businessId: ctx.business.id } });
      let from = 0;
      for (const b of bands) {
        await tx.deliveryRate.create({
          data: { zoneId, businessId: ctx.business.id, minWeightG: from, maxWeightG: b.upToKg, feeKobo: b.fee, freeOverKobo: b.freeOver, etaDaysMin: b.etaMin, etaDaysMax: b.etaMax },
        });
        from = b.upToKg ?? from;
      }
    });
    revalidatePath("/dashboard/settings/delivery");
    return { ok: true, message: "Your rates for this zone are saved. Checkout uses them from now on." };
  } catch (err) {
    return failure(err);
  }
}

/** Goes back to TownMart's default rates for a zone. */
export async function resetZoneRatesAction(input: { zoneId: string }): Promise<ActionResult> {
  const parsed = z.object({ zoneId: z.uuid() }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller();
    await withSellerRls(ctx, (tx) => tx.deliveryRate.deleteMany({ where: { zoneId: parsed.data.zoneId, businessId: ctx.business.id } }));
    revalidatePath("/dashboard/settings/delivery");
    return { ok: true, message: "This zone uses TownMart's rates again." };
  } catch (err) {
    return failure(err);
  }
}
