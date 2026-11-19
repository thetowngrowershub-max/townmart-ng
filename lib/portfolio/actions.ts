"use server";

import { revalidatePath } from "next/cache";
import { assertCan, AuthzError } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { storage } from "@/lib/storage";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { portfolioInputSchema, type PortfolioInput } from "@/lib/validation/portfolio";
import { PortfolioError, replacePortfolio } from "./portfolio";

/** A provider saves their job photos (the whole list, in order). Seller RLS. */
export async function savePortfolioAction(input: PortfolioInput): Promise<ActionResult> {
  const parsed = portfolioInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await getSellerContext();
    if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
    assertCan(ctx.user, "listing.write", { businessId: ctx.business.id });
    const { removed } = await withSellerRls(ctx, (tx) => replacePortfolio(tx, ctx.business.id, parsed.data.photos));
    await Promise.all(removed.map((k) => storage().deleteObject("public", k).catch((err) => logger.warn({ err, key: k }, "portfolio photo delete failed"))));
    revalidatePath("/dashboard/portfolio");
    revalidatePath(`/store/${ctx.business.slug}`);
    return { ok: true, message: parsed.data.photos.length ? "Job photos saved. They're on your store page now." : "Job photos removed." };
  } catch (err) {
    if (err instanceof PortfolioError || err instanceof AuthzError) return { ok: false, error: err.message };
    logger.error({ err }, "portfolio save failed");
    return { ok: false, error: "Something went wrong. Please try again." };
  }
}
