import { Prisma, type DiscountType as DbDiscountType, type PromotionScope as DbScope } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { listingPrice, type ListingDeal, type PricedItem, type PromotionRule } from "@/lib/pricing";

export type { ListingDeal };

type RuleRow = {
  id: string;
  businessId: string | null;
  name: string;
  discountType: DbDiscountType;
  discountValue: bigint;
  scope: DbScope;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  isFlashDeal: boolean;
  minOrderKobo: bigint;
  usageLimit: number | null;
  redemptionCount: number;
  perCustomerLimit: number | null;
  targets: { productId: string | null; serviceId: string | null; categoryId: string | null }[];
};

export function toRule(r: RuleRow, coupon: PromotionRule["coupon"] = null): PromotionRule {
  return {
    id: r.id,
    businessId: r.businessId,
    name: r.name,
    discountType: r.discountType,
    discountValue: r.discountValue,
    scope: r.scope,
    productIds: r.targets.flatMap((t) => (t.productId ? [t.productId] : [])),
    serviceIds: r.targets.flatMap((t) => (t.serviceId ? [t.serviceId] : [])),
    categoryIds: r.targets.flatMap((t) => (t.categoryId ? [t.categoryId] : [])),
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    isActive: r.isActive,
    isFlashDeal: r.isFlashDeal,
    minOrderKobo: r.minOrderKobo,
    usageLimit: r.usageLimit,
    redemptionCount: r.redemptionCount,
    perCustomerLimit: r.perCustomerLimit,
    coupon,
  };
}

/**
 * Live automatic promotions (no coupon, no minimum order) that could cover
 * listings of these businesses, plus platform-wide ones. Runs in the caller's
 * transaction, normally as a guest.
 */
export async function loadListingRules(tx: Tx, businessIds: readonly string[], now = new Date()): Promise<PromotionRule[]> {
  if (businessIds.length === 0) return [];
  const rows = await tx.promotion.findMany({
    where: {
      isActive: true,
      hasCoupon: false,
      minOrderKobo: 0,
      startsAt: { lte: now },
      endsAt: { gt: now },
      OR: [{ businessId: { in: [...new Set(businessIds)] } }, { businessId: null }],
    },
    include: { targets: { select: { productId: true, serviceId: true, categoryId: true } } },
  });
  return rows.map((r) => toRule(r));
}

export function dealFor(item: PricedItem, unitPriceKobo: bigint, rules: readonly PromotionRule[], now = new Date()): ListingDeal | null {
  const p = listingPrice(item, unitPriceKobo, rules, now);
  if (!p.promotion || p.discountKobo <= 0n) return null;
  return {
    originalKobo: p.originalKobo,
    finalKobo: p.finalKobo,
    percentOff: p.percentOff,
    promotionName: p.promotion.name,
    endsAt: p.promotion.endsAt,
    isFlashDeal: p.promotion.isFlashDeal,
  };
}

/**
 * SQL for "this listing has a live automatic promotion", for the search
 * filter. Mirrors loadListingRules + covers() in lib/pricing.
 */
export function onPromotionSql(kind: "product" | "service", alias: string, flashOnly = false): Prisma.Sql {
  const a = Prisma.raw(alias);
  const idCol = Prisma.raw(kind === "product" ? "t.product_id" : "t.service_id");
  return Prisma.sql`EXISTS (
    SELECT 1 FROM promotions pr
     WHERE pr.is_active AND NOT pr.has_coupon AND pr.min_order_kobo = 0
       AND pr.starts_at <= now() AND pr.ends_at > now()
       ${flashOnly ? Prisma.sql`AND pr.is_flash_deal` : Prisma.empty}
       AND (pr.usage_limit IS NULL OR pr.redemption_count < pr.usage_limit)
       AND (pr.business_id IS NULL OR pr.business_id = ${a}.business_id)
       AND (pr.scope = 'store' OR EXISTS (
         SELECT 1 FROM promotion_targets t
          WHERE t.promotion_id = pr.id
            AND (${idCol} = ${a}.id
                 OR t.category_id = ${a}.category_id
                 OR t.category_id = (SELECT c.parent_id FROM categories c WHERE c.id = ${a}.category_id)))))`;
}
