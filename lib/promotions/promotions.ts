import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import type { PromotionData } from "@/lib/validation/promotions";

export class PromotionError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * Creates or updates a promotion, its targets and its coupon in the caller's
 * transaction: a seller's (RLS-scoped to the seller, targets checked against
 * their own listings here as well as by the database), or TownMart's
 * platform-wide one when businessId is null (admin scope).
 */
export async function savePromotion(
  tx: Tx,
  params: { businessId: string | null; actorUserId: string; data: PromotionData; promotionId?: string },
): Promise<{ id: string }> {
  const { businessId, data } = params;

  // TownMart's promotions target everything or whole categories, never one seller's listings.
  if (businessId === null && (data.productIds.length || data.serviceIds.length)) throw new PromotionError("TownMart promotions cover everything or whole categories", "scope");
  if (businessId !== null && data.productIds.length) {
    const found = await tx.product.count({ where: { id: { in: data.productIds }, businessId, deletedAt: null } });
    if (found !== new Set(data.productIds).size) throw new PromotionError("Some of those products aren't in your store", "productIds");
  }
  if (businessId !== null && data.serviceIds.length) {
    const found = await tx.service.count({ where: { id: { in: data.serviceIds }, businessId, deletedAt: null } });
    if (found !== new Set(data.serviceIds).size) throw new PromotionError("Some of those services aren't in your store", "serviceIds");
  }
  if (data.categoryIds.length) {
    const found = await tx.category.count({ where: { id: { in: data.categoryIds }, isActive: true } });
    if (found !== new Set(data.categoryIds).size) throw new PromotionError("Choose categories from the list", "categoryIds");
  }

  const fields = {
    name: data.name,
    description: data.description || null,
    discountType: data.discountType,
    discountValue: data.discountValue,
    scope: data.scope,
    startsAt: data.startsAt,
    endsAt: data.endsAt,
    usageLimit: data.usageLimit,
    perCustomerLimit: data.perCustomerLimit,
    minOrderKobo: data.minOrderKobo,
    isFlashDeal: data.isFlashDeal,
    isActive: data.isActive,
  };

  let id: string;
  if (params.promotionId) {
    const existing = await tx.promotion.findFirst({ where: { id: params.promotionId, businessId }, select: { id: true } });
    if (!existing) throw new PromotionError("Promotion not found");
    await tx.promotion.update({ where: { id: existing.id }, data: fields });
    id = existing.id;
  } else {
    const created = await tx.promotion.create({ data: { ...fields, businessId, createdBy: params.actorUserId } });
    id = created.id;
  }

  await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
  const targets = [
    ...[...new Set(data.productIds)].map((productId) => ({ promotionId: id, productId })),
    ...[...new Set(data.serviceIds)].map((serviceId) => ({ promotionId: id, serviceId })),
    ...[...new Set(data.categoryIds)].map((categoryId) => ({ promotionId: id, categoryId })),
  ];
  // business_id is copied from the promotion by a trigger.
  if (targets.length) await tx.promotionTarget.createMany({ data: targets });

  const coupon = await tx.coupon.findUnique({ where: { promotionId: id }, select: { id: true, code: true, _count: { select: { redemptions: true } } } });
  if (data.couponCode) {
    if (coupon && coupon.code.toUpperCase() !== data.couponCode && coupon._count.redemptions > 0) {
      throw new PromotionError("Customers have used this code, so it can't be changed. End this promotion and create a new one.", "couponCode");
    }
    try {
      await tx.coupon.upsert({
        where: { promotionId: id },
        create: { promotionId: id, code: data.couponCode, allowsStacking: data.allowsStacking },
        update: { code: data.couponCode, allowsStacking: data.allowsStacking },
      });
    } catch (err) {
      // The whole transaction rolls back; the seller sees which field to fix.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new PromotionError("That code is already in use on TownMart. Try another.", "couponCode");
      }
      throw err;
    }
  } else if (coupon) {
    if (coupon._count.redemptions > 0) {
      throw new PromotionError("Customers have used this code, so it can't be removed. End this promotion instead.", "couponCode");
    }
    await tx.coupon.delete({ where: { id: coupon.id } });
  }

  return { id };
}

/** Pause and resume flip is_active; "end" stops a promotion now and keeps its history. */
export async function changePromotion(tx: Tx, businessId: string | null, id: string, change: "pause" | "resume" | "end") {
  const p = await tx.promotion.findFirst({ where: { id, businessId }, select: { startsAt: true, endsAt: true } });
  if (!p) throw new PromotionError("Promotion not found");
  const now = new Date();
  if (now >= p.endsAt) throw new PromotionError("This promotion has already ended.");
  const data =
    change === "end"
      ? // ends_at must stay after starts_at; a promotion that hasn't started yet ends the moment it would start.
        { endsAt: p.startsAt > now ? new Date(p.startsAt.getTime() + 1000) : now, isActive: false }
      : { isActive: change === "resume" };
  await tx.promotion.update({ where: { id }, data });
}

/** Only promotions nobody has used can be deleted; used ones are ended instead, so order history stays intact. */
export async function deletePromotion(tx: Tx, businessId: string | null, id: string): Promise<{ name: string }> {
  const p = await tx.promotion.findFirst({ where: { id, businessId }, select: { name: true, redemptionCount: true } });
  if (!p) throw new PromotionError("Promotion not found");
  if (p.redemptionCount > 0) throw new PromotionError("Customers have used this promotion, so it can't be deleted. End it instead.");
  await tx.promotion.delete({ where: { id } });
  return { name: p.name };
}

export const changeLabel = (change: "pause" | "resume" | "end") => (change === "end" ? "ended" : change === "pause" ? "paused" : "resumed");

export type PromotionStatus = "scheduled" | "live" | "paused" | "ended" | "used_up";

export function promotionStatus(
  p: { isActive: boolean; startsAt: Date; endsAt: Date; usageLimit: number | null; redemptionCount: number },
  now = new Date(),
): PromotionStatus {
  if (now >= p.endsAt) return "ended";
  if (p.usageLimit !== null && p.redemptionCount >= p.usageLimit) return "used_up";
  if (!p.isActive) return "paused";
  if (now < p.startsAt) return "scheduled";
  return "live";
}
