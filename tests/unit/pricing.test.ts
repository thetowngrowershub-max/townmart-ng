import { describe, expect, it } from "vitest";
import { covers, isLive, lineSubtotal, listingPrice, priceCart, unitDiscount, type CartLine, type PricedItem, type PromotionRule } from "@/lib/pricing";

const NOW = new Date("2026-11-01T12:00:00+01:00");
const DAY = 86_400_000;
const SHOP = "biz-shop";
const OTHER = "biz-other";

function rule(over: Partial<PromotionRule> = {}): PromotionRule {
  return {
    id: over.id ?? "promo-1",
    businessId: SHOP,
    name: "Promo",
    discountType: "percentage",
    discountValue: 10n,
    scope: "store",
    productIds: [],
    serviceIds: [],
    categoryIds: [],
    startsAt: new Date(NOW.getTime() - DAY),
    endsAt: new Date(NOW.getTime() + DAY),
    isActive: true,
    isFlashDeal: false,
    minOrderKobo: 0n,
    usageLimit: null,
    redemptionCount: 0,
    perCustomerLimit: null,
    coupon: null,
    ...over,
  };
}

const rice: PricedItem = { kind: "product", id: "rice", businessId: SHOP, categoryId: "cat-rice", parentCategoryId: "cat-groceries" };
const oil: PricedItem = { kind: "product", id: "oil", businessId: SHOP, categoryId: "cat-oil", parentCategoryId: "cat-groceries" };
const plumbing: PricedItem = { kind: "service", id: "plumb", businessId: SHOP, categoryId: "cat-plumbing", parentCategoryId: "cat-services" };
const theirs: PricedItem = { kind: "product", id: "phone", businessId: OTHER, categoryId: "cat-phones", parentCategoryId: "cat-electronics" };

const line = (item: PricedItem, unit: bigint, qty = 1000n, key = item.id): CartLine => ({ key, item, unitPriceKobo: unit, quantityMilli: qty });

describe("unitDiscount", () => {
  it("takes a percentage, rounding half a kobo up", () => {
    expect(unitDiscount({ discountType: "percentage", discountValue: 15n }, 980_000n)).toBe(147_000n);
    expect(unitDiscount({ discountType: "percentage", discountValue: 10n }, 105n)).toBe(11n); // 10.5 → 11
    expect(unitDiscount({ discountType: "percentage", discountValue: 10n }, 104n)).toBe(10n);
  });

  it("never takes more than the price", () => {
    expect(unitDiscount({ discountType: "fixed", discountValue: 500_000n }, 200_000n)).toBe(200_000n);
    expect(unitDiscount({ discountType: "percentage", discountValue: 100n }, 99_999n)).toBe(99_999n);
    expect(unitDiscount({ discountType: "fixed", discountValue: 100n }, 0n)).toBe(0n);
  });
});

describe("isLive", () => {
  it("respects the window, the active flag and the usage limit", () => {
    expect(isLive(rule(), NOW)).toBe(true);
    expect(isLive(rule({ isActive: false }), NOW)).toBe(false);
    expect(isLive(rule({ startsAt: new Date(NOW.getTime() + 1) }), NOW)).toBe(false);
    expect(isLive(rule({ endsAt: NOW }), NOW)).toBe(false); // ends_at is exclusive
    expect(isLive(rule({ startsAt: NOW }), NOW)).toBe(true); // starts_at is inclusive
    expect(isLive(rule({ usageLimit: 5, redemptionCount: 5 }), NOW)).toBe(false);
    expect(isLive(rule({ usageLimit: 5, redemptionCount: 4 }), NOW)).toBe(true);
  });
});

describe("covers", () => {
  it("never lets a seller's promotion touch another seller's listings", () => {
    expect(covers(rule({ scope: "store" }), theirs)).toBe(false);
    expect(covers(rule({ scope: "products", productIds: ["phone"] }), theirs)).toBe(false);
  });

  it("lets platform-wide promotions cover any seller", () => {
    expect(covers(rule({ businessId: null, scope: "store" }), theirs)).toBe(true);
    expect(covers(rule({ businessId: null, scope: "category", categoryIds: ["cat-electronics"] }), theirs)).toBe(true);
  });

  it("matches by scope", () => {
    expect(covers(rule({ scope: "product", productIds: ["rice"] }), rice)).toBe(true);
    expect(covers(rule({ scope: "products", productIds: ["rice"] }), oil)).toBe(false);
    expect(covers(rule({ scope: "service", serviceIds: ["plumb"] }), plumbing)).toBe(true);
    expect(covers(rule({ scope: "service", serviceIds: ["rice"] }), rice)).toBe(false); // ids don't cross kinds
    expect(covers(rule({ scope: "store" }), plumbing)).toBe(true);
  });

  it("covers subcategories of a promoted category", () => {
    const groceries = rule({ scope: "category", categoryIds: ["cat-groceries"] });
    expect(covers(groceries, rice)).toBe(true);
    expect(covers(groceries, oil)).toBe(true);
    expect(covers(rule({ scope: "category", categoryIds: ["cat-rice"] }), oil)).toBe(false);
  });
});

describe("listingPrice", () => {
  it("shows the single best live automatic discount", () => {
    const rules = [rule({ id: "a", discountValue: 10n }), rule({ id: "b", discountType: "fixed", discountValue: 200_000n }), rule({ id: "c", discountValue: 15n })];
    const p = listingPrice(rice, 980_000n, rules, NOW);
    expect(p.promotion?.id).toBe("b"); // ₦2,000 beats 15% of ₦9,800 (₦1,470)
    expect(p.finalKobo).toBe(780_000n);
    expect(p.percentOff).toBe(20);
  });

  it("ignores coupon and minimum-order promotions, which only apply in the cart", () => {
    const rules = [
      rule({ id: "coupon", discountValue: 50n, coupon: { id: "c1", code: "HALF", allowsStacking: false } }),
      rule({ id: "min", discountValue: 40n, minOrderKobo: 1_000_000n }),
    ];
    const p = listingPrice(rice, 980_000n, rules, NOW);
    expect(p.promotion).toBeNull();
    expect(p.finalKobo).toBe(980_000n);
  });

  it("ignores ended, scheduled and paused promotions", () => {
    const rules = [rule({ endsAt: new Date(NOW.getTime() - 1) }), rule({ startsAt: new Date(NOW.getTime() + DAY) }), rule({ isActive: false })];
    expect(listingPrice(rice, 980_000n, rules, NOW).promotion).toBeNull();
  });

  it("breaks ties by the earliest end so the badge shows the real deadline", () => {
    const later = rule({ id: "later", endsAt: new Date(NOW.getTime() + 3 * DAY) });
    const sooner = rule({ id: "sooner", endsAt: new Date(NOW.getTime() + DAY), isFlashDeal: true });
    const p = listingPrice(rice, 100_000n, [later, sooner], NOW);
    expect(p.promotion?.id).toBe("sooner");
    expect(p.promotion?.isFlashDeal).toBe(true);
  });

  it("floors a fixed discount bigger than the price at ₦0", () => {
    const p = listingPrice(rice, 50_000n, [rule({ discountType: "fixed", discountValue: 80_000n })], NOW);
    expect(p.finalKobo).toBe(0n);
    expect(p.percentOff).toBe(100);
  });
});

describe("lineSubtotal", () => {
  it("handles fractional quantities exactly", () => {
    expect(lineSubtotal(250_000n, 1500n)).toBe(375_000n); // 1.5 kg at ₦2,500
    expect(lineSubtotal(333n, 1000n)).toBe(333n);
    expect(lineSubtotal(333n, 500n)).toBe(167n); // 166.5 → 167
  });
});

describe("priceCart", () => {
  it("applies automatic promotions per line and totals exactly", () => {
    const cart = priceCart([line(rice, 980_000n, 2000n), line(oil, 420_000n)], [rule({ scope: "products", productIds: ["rice"], discountValue: 15n })], { now: NOW });
    expect(cart.subtotalKobo).toBe(2_380_000n);
    expect(cart.lines[0]!.discountKobo).toBe(294_000n); // 15% × ₦9,800 × 2
    expect(cart.lines[1]!.discountKobo).toBe(0n);
    expect(cart.totalKobo).toBe(2_086_000n);
    expect(cart.redemptions).toEqual([{ promotionId: "promo-1", couponId: null, businessId: SHOP, discountKobo: 294_000n }]);
  });

  it("applies a fixed amount to each unit", () => {
    const cart = priceCart([line(rice, 980_000n, 3000n)], [rule({ discountType: "fixed", discountValue: 50_000n })], { now: NOW });
    expect(cart.discountKobo).toBe(150_000n);
  });

  it("checks the minimum order against that seller's items only", () => {
    const min = rule({ discountValue: 10n, minOrderKobo: 2_000_000n });
    const small = priceCart([line(rice, 980_000n), line(theirs, 5_000_000n)], [min], { now: NOW });
    expect(small.discountKobo).toBe(0n); // ₦9,800 from this seller is under ₦20,000
    const big = priceCart([line(rice, 980_000n, 3000n)], [min], { now: NOW });
    expect(big.discountKobo).toBe(294_000n);
  });

  it("respects the per-customer limit", () => {
    const limited = rule({ perCustomerLimit: 1 });
    const used = priceCart([line(rice, 100_000n)], [limited], { now: NOW, customerUsage: new Map([["promo-1", 1]]) });
    expect(used.discountKobo).toBe(0n);
  });

  describe("coupons", () => {
    const coupon = (over: Partial<PromotionRule> = {}) =>
      rule({ id: "cpn", discountValue: 20n, coupon: { id: "coupon-1", code: "YABA20", allowsStacking: false }, ...over });

    it("applies a valid code, case-insensitively", () => {
      const cart = priceCart([line(rice, 100_000n)], [coupon()], { now: NOW, couponCode: " yaba20 " });
      expect(cart.coupon).toMatchObject({ state: "applied", code: "YABA20", discountKobo: 20_000n, stacked: false });
      expect(cart.totalKobo).toBe(80_000n);
      expect(cart.redemptions).toEqual([{ promotionId: "cpn", couponId: "coupon-1", businessId: SHOP, discountKobo: 20_000n }]);
    });

    it("doesn't apply without the code", () => {
      expect(priceCart([line(rice, 100_000n)], [coupon()], { now: NOW }).discountKobo).toBe(0n);
    });

    it("replaces a smaller automatic discount instead of stacking", () => {
      const cart = priceCart([line(rice, 100_000n)], [rule({ id: "auto", discountValue: 10n }), coupon()], { now: NOW, couponCode: "YABA20" });
      expect(cart.discountKobo).toBe(20_000n);
      expect(cart.lines[0]!.promotions.map((p) => p.id)).toEqual(["cpn"]);
      expect(cart.redemptions.map((r) => r.promotionId)).toEqual(["cpn"]);
    });

    it("keeps a better automatic discount and says the code didn't help", () => {
      const cart = priceCart([line(rice, 100_000n)], [rule({ id: "auto", discountValue: 30n }), coupon()], { now: NOW, couponCode: "YABA20" });
      expect(cart.discountKobo).toBe(30_000n);
      expect(cart.coupon).toEqual({ state: "not_applicable", message: "Your cart already has a better discount than this code." });
    });

    it("stacks on top of the automatic discount when the coupon allows it", () => {
      const stacking = coupon({ coupon: { id: "coupon-1", code: "YABA20", allowsStacking: true } });
      const cart = priceCart([line(rice, 100_000n)], [rule({ id: "auto", discountValue: 10n }), stacking], { now: NOW, couponCode: "YABA20" });
      // 10% off ₦1,000 = ₦100; then 20% off the remaining ₦900 = ₦180.
      expect(cart.discountKobo).toBe(28_000n);
      expect(cart.coupon).toMatchObject({ state: "applied", stacked: true, discountKobo: 18_000n });
    });

    it("never takes a stacked line below ₦0", () => {
      const stacking = coupon({ discountType: "fixed", discountValue: 90_000n, coupon: { id: "coupon-1", code: "BIG", allowsStacking: true } });
      const cart = priceCart([line(rice, 100_000n, 2000n)], [rule({ id: "auto", discountValue: 50n }), stacking], { now: NOW, couponCode: "BIG" });
      expect(cart.lines[0]!.totalKobo).toBe(0n);
      expect(cart.totalKobo).toBe(0n);
    });

    it("explains why a code can't be used", () => {
      const lines = [line(rice, 100_000n)];
      expect(priceCart(lines, [coupon()], { now: NOW, couponCode: "NOPE" }).coupon).toEqual({ state: "invalid", message: "That code isn't valid." });
      expect(priceCart(lines, [coupon({ endsAt: NOW })], { now: NOW, couponCode: "YABA20" }).coupon).toMatchObject({ message: "That code has expired." });
      expect(priceCart(lines, [coupon({ startsAt: new Date(NOW.getTime() + DAY) })], { now: NOW, couponCode: "YABA20" }).coupon).toMatchObject({
        message: "That code isn't active yet.",
      });
      expect(priceCart(lines, [coupon({ isActive: false })], { now: NOW, couponCode: "YABA20" }).coupon).toMatchObject({ state: "invalid" });
      expect(priceCart(lines, [coupon({ usageLimit: 10, redemptionCount: 10 })], { now: NOW, couponCode: "YABA20" }).coupon).toMatchObject({
        message: "That code has been fully used.",
      });
      expect(
        priceCart(lines, [coupon({ perCustomerLimit: 1 })], { now: NOW, couponCode: "YABA20", customerUsage: new Map([["cpn", 1]]) }).coupon,
      ).toMatchObject({ state: "invalid" });
      expect(priceCart([line(theirs, 100_000n)], [coupon()], { now: NOW, couponCode: "YABA20" }).coupon).toMatchObject({ state: "not_applicable" });
      expect(priceCart(lines, [coupon({ minOrderKobo: 2_000_000n })], { now: NOW, couponCode: "YABA20" }).coupon).toEqual({
        state: "not_applicable",
        message: "Spend ₦19,000 more with this seller to use this code.",
      });
    });
  });
});
