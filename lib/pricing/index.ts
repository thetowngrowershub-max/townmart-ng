import { formatPrice } from "@/lib/money";

/**
 * TownMart pricing engine. Pure functions over BigInt kobo: no database, no
 * clock (callers pass `now`), so every rule here is unit-tested.
 *
 * Rules (spec §6.5):
 *  - Promotions take a percentage or a fixed naira amount off each unit.
 *  - A line gets the single best discount. A coupon replaces the automatic
 *    discount when it is better, unless the coupon allows stacking, in which
 *    case it applies on top of the automatic discount.
 *  - A price never goes below ₦0.
 *  - Promotions with a coupon or a minimum order value only apply in the cart;
 *    listings show automatic promotions only, so a listed price is always a
 *    price the shopper can actually get.
 */

export type DiscountType = "percentage" | "fixed";
export type PromotionScope = "product" | "products" | "category" | "store" | "service";

export type PromotionRule = {
  id: string;
  /** null = platform-wide */
  businessId: string | null;
  name: string;
  discountType: DiscountType;
  /** percentage: whole percent 1-100; fixed: kobo off each unit */
  discountValue: bigint;
  scope: PromotionScope;
  productIds: readonly string[];
  serviceIds: readonly string[];
  categoryIds: readonly string[];
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  isFlashDeal: boolean;
  minOrderKobo: bigint;
  usageLimit: number | null;
  redemptionCount: number;
  perCustomerLimit: number | null;
  coupon: { id: string; code: string; allowsStacking: boolean } | null;
};

export type PricedItem = {
  kind: "product" | "service";
  id: string;
  businessId: string;
  categoryId: string;
  /** The category's parent, so a promotion on "Groceries" covers "Rice & grains". */
  parentCategoryId: string | null;
};

export type AppliedPromotion = {
  id: string;
  name: string;
  endsAt: Date;
  isFlashDeal: boolean;
  discountType: DiscountType;
  discountValue: bigint;
};

/** Round a non-negative rational a/b to the nearest kobo, halves up. */
function roundDiv(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

export function isLive(rule: PromotionRule, now: Date): boolean {
  return (
    rule.isActive &&
    rule.startsAt.getTime() <= now.getTime() &&
    now.getTime() < rule.endsAt.getTime() &&
    (rule.usageLimit === null || rule.redemptionCount < rule.usageLimit)
  );
}

/** Does this rule cover this item? Seller promotions only ever cover the seller's own listings. */
export function covers(rule: PromotionRule, item: PricedItem): boolean {
  if (rule.businessId !== null && rule.businessId !== item.businessId) return false;
  switch (rule.scope) {
    case "store":
      return true;
    case "product":
    case "products":
      return item.kind === "product" && rule.productIds.includes(item.id);
    case "service":
      return item.kind === "service" && rule.serviceIds.includes(item.id);
    case "category":
      return rule.categoryIds.includes(item.categoryId) || (item.parentCategoryId !== null && rule.categoryIds.includes(item.parentCategoryId));
  }
}

/** Discount on one unit, capped at the unit price. */
export function unitDiscount(rule: Pick<PromotionRule, "discountType" | "discountValue">, unitPriceKobo: bigint): bigint {
  if (unitPriceKobo <= 0n) return 0n;
  const raw = rule.discountType === "percentage" ? roundDiv(unitPriceKobo * rule.discountValue, 100n) : rule.discountValue;
  return raw > unitPriceKobo ? unitPriceKobo : raw;
}

const applied = (r: PromotionRule): AppliedPromotion => ({
  id: r.id,
  name: r.name,
  endsAt: r.endsAt,
  isFlashDeal: r.isFlashDeal,
  discountType: r.discountType,
  discountValue: r.discountValue,
});

/** Promotions that can show on a listing: automatic (no coupon) and no minimum order. */
export function isListingPromotion(rule: PromotionRule): boolean {
  return rule.coupon === null && rule.minOrderKobo === 0n;
}

/** What a listing card or page needs to show a deal. */
export type ListingDeal = {
  originalKobo: bigint;
  finalKobo: bigint;
  percentOff: number;
  promotionName: string;
  endsAt: Date;
  isFlashDeal: boolean;
};

export type ListingPrice = {
  originalKobo: bigint;
  finalKobo: bigint;
  discountKobo: bigint;
  /** Whole percent saved, rounded down, for the badge. */
  percentOff: number;
  promotion: AppliedPromotion | null;
};

/** Best ties: bigger discount, then the one ending soonest (so the shopper sees the real deadline), then id. */
function better(a: { d: bigint; r: PromotionRule }, b: { d: bigint; r: PromotionRule } | null) {
  if (!b) return true;
  if (a.d !== b.d) return a.d > b.d;
  if (a.r.endsAt.getTime() !== b.r.endsAt.getTime()) return a.r.endsAt < b.r.endsAt;
  return a.r.id < b.r.id;
}

/** The price a listing shows for one unit at `unitPriceKobo`. */
export function listingPrice(item: PricedItem, unitPriceKobo: bigint, rules: readonly PromotionRule[], now: Date): ListingPrice {
  let best: { d: bigint; r: PromotionRule } | null = null;
  for (const r of rules) {
    if (!isListingPromotion(r) || !isLive(r, now) || !covers(r, item)) continue;
    const cand = { d: unitDiscount(r, unitPriceKobo), r };
    if (cand.d > 0n && better(cand, best)) best = cand;
  }
  const discount = best?.d ?? 0n;
  return {
    originalKobo: unitPriceKobo,
    finalKobo: unitPriceKobo - discount,
    discountKobo: discount,
    percentOff: unitPriceKobo > 0n ? Number((discount * 100n) / unitPriceKobo) : 0,
    promotion: best ? applied(best.r) : null,
  };
}

// ─── Cart ───────────────────────────────────────────────────────────────────

export type CartLine = {
  key: string;
  item: PricedItem;
  unitPriceKobo: bigint;
  /** Quantity in thousandths (kg and litres can be fractional): 1.5 kg = 1500. */
  quantityMilli: bigint;
};

export type CouponStatus =
  | { state: "none" }
  | { state: "applied"; promotion: AppliedPromotion; code: string; discountKobo: bigint; stacked: boolean }
  | { state: "invalid"; message: string }
  | { state: "not_applicable"; message: string };

export type PricedLine = {
  key: string;
  subtotalKobo: bigint;
  discountKobo: bigint;
  totalKobo: bigint;
  promotions: AppliedPromotion[];
  /** Who pays for each part of the discount: the seller, or TownMart (fundedBy null). */
  parts: { promotionId: string; fundedBy: string | null; discountKobo: bigint }[];
};

export type Redemption = { promotionId: string; couponId: string | null; businessId: string | null; discountKobo: bigint };

export type PricedCart = {
  lines: PricedLine[];
  subtotalKobo: bigint;
  discountKobo: bigint;
  totalKobo: bigint;
  coupon: CouponStatus;
  /** One per promotion used, for promotion_redemptions when the order is placed. */
  redemptions: Redemption[];
};

export type CartContext = {
  now: Date;
  couponCode?: string | null;
  /** How many times this customer has already used each promotion. */
  customerUsage?: ReadonlyMap<string, number>;
};

export function lineSubtotal(unitPriceKobo: bigint, quantityMilli: bigint): bigint {
  return roundDiv(unitPriceKobo * quantityMilli, 1000n);
}

/** Discount for a whole line: per-unit discount times quantity, capped at what's left of the line. */
function lineDiscount(rule: PromotionRule, unitPriceKobo: bigint, quantityMilli: bigint, alreadyOffKobo: bigint): bigint {
  const remainingUnit = unitPriceKobo - (quantityMilli > 0n ? (alreadyOffKobo * 1000n) / quantityMilli : 0n);
  const perUnit = unitDiscount(rule, remainingUnit);
  const total = roundDiv(perUnit * quantityMilli, 1000n);
  const cap = lineSubtotal(unitPriceKobo, quantityMilli) - alreadyOffKobo;
  return total > cap ? cap : total;
}

const normaliseCode = (code: string) => code.trim().toUpperCase();

/**
 * Prices a cart. Minimum order values are checked against the subtotal of the
 * promotion's own seller (or the whole cart for platform-wide promotions),
 * before discounts.
 */
export function priceCart(lines: readonly CartLine[], rules: readonly PromotionRule[], ctx: CartContext): PricedCart {
  const usage = ctx.customerUsage ?? new Map<string, number>();
  const subtotals = lines.map((l) => lineSubtotal(l.unitPriceKobo, l.quantityMilli));
  const cartSubtotal = subtotals.reduce((a, b) => a + b, 0n);
  const sellerSubtotal = (businessId: string | null) =>
    businessId === null ? cartSubtotal : lines.reduce((sum, l, i) => (l.item.businessId === businessId ? sum + subtotals[i]! : sum), 0n);

  const usable = (r: PromotionRule) =>
    isLive(r, ctx.now) && (r.perCustomerLimit === null || (usage.get(r.id) ?? 0) < r.perCustomerLimit) && sellerSubtotal(r.businessId) >= r.minOrderKobo;

  const automatic = rules.filter((r) => r.coupon === null && usable(r));

  // Resolve the coupon, if one was entered.
  const code = ctx.couponCode ? normaliseCode(ctx.couponCode) : "";
  let couponRule: PromotionRule | null = null;
  let coupon: CouponStatus = { state: "none" };
  if (code) {
    const match = rules.find((r) => r.coupon && normaliseCode(r.coupon.code) === code);
    if (!match || !match.isActive) coupon = { state: "invalid", message: "That code isn't valid." };
    else if (ctx.now < match.startsAt) coupon = { state: "invalid", message: "That code isn't active yet." };
    else if (ctx.now >= match.endsAt) coupon = { state: "invalid", message: "That code has expired." };
    else if (match.usageLimit !== null && match.redemptionCount >= match.usageLimit) coupon = { state: "invalid", message: "That code has been fully used." };
    else if (match.perCustomerLimit !== null && (usage.get(match.id) ?? 0) >= match.perCustomerLimit)
      coupon = { state: "invalid", message: "You've already used this code the maximum number of times." };
    else if (!lines.some((l) => covers(match, l.item))) coupon = { state: "not_applicable", message: "That code doesn't apply to anything in your cart." };
    else if (sellerSubtotal(match.businessId) < match.minOrderKobo)
      coupon = {
        state: "not_applicable",
        message: `Spend ${formatPrice(match.minOrderKobo - sellerSubtotal(match.businessId))} more${match.businessId ? " with this seller" : ""} to use this code.`,
      };
    else couponRule = match;
  }

  const redemptionTotals = new Map<string, Redemption>();
  const note = (r: PromotionRule, d: bigint, isCoupon: boolean) => {
    if (d <= 0n) return;
    const prev = redemptionTotals.get(r.id);
    redemptionTotals.set(r.id, {
      promotionId: r.id,
      couponId: isCoupon ? r.coupon!.id : null,
      businessId: r.businessId,
      discountKobo: (prev?.discountKobo ?? 0n) + d,
    });
  };

  let couponTotal = 0n;
  let couponStacked = false;
  const priced: PricedLine[] = lines.map((l, i) => {
    const sub = subtotals[i]!;
    let best: { d: bigint; r: PromotionRule } | null = null;
    for (const r of automatic) {
      if (!covers(r, l.item)) continue;
      const cand = { d: lineDiscount(r, l.unitPriceKobo, l.quantityMilli, 0n), r };
      if (cand.d > 0n && better(cand, best)) best = cand;
    }
    const used: { r: PromotionRule; d: bigint; isCoupon: boolean }[] = best ? [{ r: best.r, d: best.d, isCoupon: false }] : [];

    if (couponRule && covers(couponRule, l.item)) {
      if (couponRule.coupon!.allowsStacking) {
        const already = best?.d ?? 0n;
        const d = lineDiscount(couponRule, l.unitPriceKobo, l.quantityMilli, already);
        if (d > 0n) {
          used.push({ r: couponRule, d, isCoupon: true });
          couponStacked = couponStacked || already > 0n;
        }
      } else {
        const d = lineDiscount(couponRule, l.unitPriceKobo, l.quantityMilli, 0n);
        if (d > (best?.d ?? 0n)) used.splice(0, used.length, { r: couponRule, d, isCoupon: true });
      }
    }

    let discount = 0n;
    const parts: PricedLine["parts"] = [];
    for (const u of used) {
      // Never more than what's left of the line.
      const d = u.d > sub - discount ? sub - discount : u.d;
      if (d <= 0n) continue;
      discount += d;
      parts.push({ promotionId: u.r.id, fundedBy: u.r.businessId, discountKobo: d });
      note(u.r, d, u.isCoupon);
      if (u.isCoupon) couponTotal += d;
    }
    return { key: l.key, subtotalKobo: sub, discountKobo: discount, totalKobo: sub - discount, promotions: used.map((u) => applied(u.r)), parts };
  });

  if (couponRule) {
    coupon =
      couponTotal > 0n
        ? { state: "applied", promotion: applied(couponRule), code: couponRule.coupon!.code, discountKobo: couponTotal, stacked: couponStacked }
        : { state: "not_applicable", message: "Your cart already has a better discount than this code." };
  }

  const discountKobo = priced.reduce((a, l) => a + l.discountKobo, 0n);
  return {
    lines: priced,
    subtotalKobo: cartSubtotal,
    discountKobo,
    totalKobo: cartSubtotal - discountKobo,
    coupon,
    redemptions: [...redemptionTotals.values()],
  };
}
