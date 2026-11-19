import type { z } from "zod";
import type { Tx } from "@/lib/db";
import { publicImageUrl } from "@/lib/storage";
import { imagePrefix } from "@/lib/storage/uploads";
import { MAX_PORTFOLIO_PHOTOS, type portfolioInputSchema } from "@/lib/validation/portfolio";

export type PortfolioPhotoView = { key: string; url: string; width: number; height: number; caption: string };

export class PortfolioError extends Error {}

/** The business's job photos in their chosen order. Runs under the caller's RLS: public only while the shop is approved. */
export async function listPortfolio(tx: Tx, businessId: string, take = MAX_PORTFOLIO_PHOTOS): Promise<PortfolioPhotoView[]> {
  const rows = await tx.portfolioPhoto.findMany({ where: { businessId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], take });
  return rows.map((r) => ({ key: r.storageKey, url: publicImageUrl(r.storageKey), width: r.width, height: r.height, caption: r.caption }));
}

/**
 * Replaces the business's job photos with `photos`, in that order. Every key
 * must be one this business uploaded as a job photo (the database checks the
 * same). Returns the keys that were dropped, for the caller to delete from
 * storage once the transaction has committed.
 */
export async function replacePortfolio(tx: Tx, businessId: string, photos: z.output<typeof portfolioInputSchema>["photos"]): Promise<{ removed: string[] }> {
  const prefix = imagePrefix("portfolio", businessId);
  if (photos.some((p) => !p.key.startsWith(prefix) || !/^[A-Za-z0-9/_.-]+$/.test(p.key))) throw new PortfolioError("Please upload those photos again.");
  if (new Set(photos.map((p) => p.key)).size !== photos.length) throw new PortfolioError("The same photo is in the list twice.");
  const before = await tx.portfolioPhoto.findMany({ where: { businessId }, select: { storageKey: true } });
  await tx.portfolioPhoto.deleteMany({ where: { businessId } });
  if (photos.length) {
    await tx.portfolioPhoto.createMany({
      data: photos.map((p, i) => ({ businessId, storageKey: p.key, caption: p.caption, width: p.width, height: p.height, sortOrder: i })),
    });
  }
  const kept = new Set(photos.map((p) => p.key));
  return { removed: before.map((b) => b.storageKey).filter((k) => !kept.has(k)) };
}
