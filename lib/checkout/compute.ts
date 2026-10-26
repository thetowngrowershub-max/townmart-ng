import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { priceCart, type CartLine, type PricedCart, type PromotionRule } from "@/lib/pricing";
import { toRule } from "@/lib/promotions/live";
import { getCheckoutSettings, type CheckoutSettings } from "@/lib/settings";
import { DEFAULT_ITEM_WEIGHT_G, quoteDelivery, type DeliveryQuote } from "./delivery";
import { buildQuote, type OrderQuote } from "./quote";

/**
 * Everything checkout needs, worked out from the database in one place: the
 * cart page, the checkout page and order placement all call this, so the
 * shopper is charged exactly what they were shown.
 *
 * Runs in the system scope with an explicit cart id: callers resolve who owns
 * the cart first (lib/cart). Business-specific commission rules and coupon
 * codes aren't visible to shoppers under RLS, and order placement needs both.
 */

export type LineProblem =
  | { kind: "unavailable" }
  | { kind: "out_of_stock" }
  | { kind: "not_enough"; available: string }
  | { kind: "below_minimum"; minimum: string }
  | { kind: "fraction_not_allowed" };

export type ComputedLine = {
  cartItemId: string;
  variantId: string;
  productId: string;
  businessId: string;
  categoryId: string;
  parentCategoryId: string | null;
  title: string;
  slug: string;
  sku: string;
  optionValues: Record<string, string>;
  imageKey: string | null;
  imageAlt: string | null;
  unit: string;
  qty: Prisma.Decimal;
  minOrderQty: Prisma.Decimal;
  allowFractionalQty: boolean;
  trackInventory: boolean;
  allowBackorder: boolean;
  /** Stock on hand now (after other shoppers' holds). */
  stockQty: Prisma.Decimal;
  weightG: number;
  unitPriceKobo: bigint;
  savedForLater: boolean;
  problem: LineProblem | null;
};

export type SellerDelivery = {
  businessId: string;
  name: string;
  slug: string;
  city: string;
  stateName: string;
  offersDelivery: boolean;
  offersPickup: boolean;
  deliveryNotes: string;
  acceptsPayOnDelivery: boolean;
  returnWindowDays: number;
  /** Null when there's no address yet, or nobody delivers to it. */
  delivery: DeliveryQuote | null;
  method: "delivery" | "pickup" | null;
};

export type CheckoutComputation = {
  now: Date;
  settings: CheckoutSettings;
  lines: ComputedLine[];
  saved: ComputedLine[];
  priced: PricedCart;
  sellers: SellerDelivery[];
  quote: OrderQuote;
  couponCode: string | null;
  payOnDeliveryAvailable: boolean;
  /** Whether delivery was priced for an address (the cart page has none yet). */
  hasAddress: boolean;
  /** Reasons the order can't be placed as it stands. */
  blockers: string[];
};

const MILLI = new Prisma.Decimal(1000);
export const qtyMilli = (qty: Prisma.Decimal) => BigInt(qty.times(MILLI).toFixed(0));

async function loadRules(tx: Tx, businessIds: string[], couponCode: string | null, userId: string | null, now: Date): Promise<{ rules: PromotionRule[]; couponBlocked: string | null }> {
  const include = { targets: { select: { productId: true, serviceId: true, categoryId: true } } } as const;
  const automatic = await tx.promotion.findMany({
    where: {
      isActive: true,
      hasCoupon: false,
      startsAt: { lte: now },
      endsAt: { gt: now },
      OR: [{ businessId: { in: businessIds }, business: { status: "approved" } }, { businessId: null }],
    },
    include,
  });
  const rules = automatic.map((r) => toRule(r));
  let couponBlocked: string | null = null;
  if (couponCode) {
    const c = await tx.coupon.findUnique({ where: { code: couponCode }, include: { promotion: { include: { ...include, business: { select: { status: true } } } } } });
    if (c && (c.promotion.businessId === null || c.promotion.business?.status === "approved")) {
      if (!userId && c.promotion.perCustomerLimit !== null) couponBlocked = "Sign in to use this code: it has a limit per customer.";
      else rules.push(toRule(c.promotion, { id: c.id, code: c.code, allowsStacking: c.allowsStacking }));
    }
  }
  return { rules, couponBlocked };
}

export async function computeCheckout(
  tx: Tx,
  input: {
    cartId: string | null;
    userId: string | null;
    /** Where it's going; null before the shopper has chosen an address. */
    address: { stateId: number; lgaId: number } | null;
    /** The shopper's choice per seller; anything missing gets the default. */
    methods?: Readonly<Record<string, "delivery" | "pickup">>;
    now?: Date;
  },
): Promise<CheckoutComputation> {
  const now = input.now ?? new Date();
  const settings = await getCheckoutSettings(tx);
  const cart = input.cartId
    ? await tx.cart.findUnique({
        where: { id: input.cartId },
        include: {
          items: {
            orderBy: { createdAt: "asc" },
            include: {
              variant: {
                include: {
                  product: {
                    include: {
                      category: { select: { parentId: true } },
                      images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1, select: { storageKey: true, altText: true, variantId: true } },
                    },
                  },
                },
              },
              business: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  city: true,
                  status: true,
                  state: { select: { name: true } },
                  policy: { select: { deliveryOptions: true, acceptsPayOnDelivery: true, returnWindowDays: true } },
                },
              },
            },
          },
        },
      })
    : null;

  const all: ComputedLine[] = (cart?.items ?? []).map((i) => {
    const v = i.variant;
    const p = v.product;
    const live = p.status === "active" && p.deletedAt === null && i.business.status === "approved";
    let problem: LineProblem | null = null;
    if (!live) problem = { kind: "unavailable" };
    else if (!p.allowFractionalQty && !i.qty.isInteger()) problem = { kind: "fraction_not_allowed" };
    else if (i.qty.lessThan(p.minOrderQty)) problem = { kind: "below_minimum", minimum: p.minOrderQty.toString() };
    else if (p.trackInventory && !p.allowBackorder && i.qty.greaterThan(v.stockQty))
      problem = v.stockQty.lte(0) ? { kind: "out_of_stock" } : { kind: "not_enough", available: v.stockQty.toString() };
    return {
      cartItemId: i.id,
      variantId: v.id,
      productId: p.id,
      businessId: i.businessId,
      categoryId: p.categoryId,
      parentCategoryId: p.category.parentId,
      title: p.title,
      slug: p.slug,
      sku: v.sku,
      optionValues: (v.optionValues ?? {}) as Record<string, string>,
      imageKey: p.images[0]?.storageKey ?? null,
      imageAlt: p.images[0]?.altText ?? null,
      unit: p.unit,
      qty: i.qty,
      minOrderQty: p.minOrderQty,
      allowFractionalQty: p.allowFractionalQty,
      trackInventory: p.trackInventory,
      allowBackorder: p.allowBackorder,
      stockQty: v.stockQty,
      weightG: Math.ceil((p.weightGrams ?? DEFAULT_ITEM_WEIGHT_G) * i.qty.toNumber()),
      unitPriceKobo: v.priceKobo,
      problem,
      savedForLater: i.savedForLater,
    };
  });
  const lines = all.filter((l) => !l.savedForLater);
  const saved = all.filter((l) => l.savedForLater);
  // Unavailable items stay visible in the cart but aren't priced or ordered.
  const sellable = lines.filter((l) => l.problem?.kind !== "unavailable");

  const businessIds = [...new Set(sellable.map((l) => l.businessId))];
  const couponCode = cart?.couponCode ?? null;
  const { rules, couponBlocked } = await loadRules(tx, businessIds, couponCode, input.userId, now);
  const usage = new Map<string, number>();
  if (input.userId) {
    const used = await tx.promotionRedemption.groupBy({ by: ["promotionId"], where: { userId: input.userId, order: { cancelledAt: null } }, _count: true });
    for (const u of used) usage.set(u.promotionId, u._count);
  }
  const cartLines: CartLine[] = sellable.map((l) => ({
    key: l.cartItemId,
    item: { kind: "product", id: l.productId, businessId: l.businessId, categoryId: l.categoryId, parentCategoryId: l.parentCategoryId },
    unitPriceKobo: l.unitPriceKobo,
    quantityMilli: qtyMilli(l.qty),
  }));
  const priced = priceCart(cartLines, rules, { now, couponCode, customerUsage: usage });
  if (couponBlocked) priced.coupon = { state: "invalid", message: couponBlocked };

  // Delivery per seller.
  const [zones, rates] = input.address
    ? await Promise.all([
        tx.deliveryZone.findMany({ where: { isActive: true } }),
        tx.deliveryRate.findMany({ where: { OR: [{ businessId: null }, { businessId: { in: businessIds } }] } }),
      ])
    : [[], []];
  const pricedByKey = new Map(priced.lines.map((l) => [l.key, l]));
  const sellers: SellerDelivery[] = businessIds.map((businessId) => {
    const own = sellable.filter((l) => l.businessId === businessId);
    const b = cart!.items.find((i) => i.businessId === businessId)!.business;
    const opts = (b.policy?.deliveryOptions ?? { delivery: true, pickup: false }) as { delivery?: boolean; pickup?: boolean; notes?: string };
    const offersDelivery = opts.delivery !== false;
    const offersPickup = opts.pickup === true;
    const goods = own.reduce((a, l) => a + (pricedByKey.get(l.cartItemId)?.totalKobo ?? 0n), 0n);
    const delivery =
      input.address && offersDelivery
        ? quoteDelivery({
            zones: zones.map((z) => ({ id: z.id, name: z.name, stateIds: z.stateIds, lgaIds: z.lgaIds, priority: z.priority })),
            rates,
            businessId,
            stateId: input.address.stateId,
            lgaId: input.address.lgaId,
            weightG: own.reduce((a, l) => a + l.weightG, 0),
            goodsKobo: goods,
          })
        : null;
    const wanted = input.methods?.[businessId];
    const method =
      wanted === "pickup" && offersPickup ? "pickup" : wanted === "delivery" && delivery ? "delivery" : delivery ? "delivery" : offersPickup ? "pickup" : null;
    return {
      businessId,
      name: b.name,
      slug: b.slug,
      city: b.city,
      stateName: b.state.name,
      offersDelivery,
      offersPickup,
      deliveryNotes: opts.notes ?? "",
      acceptsPayOnDelivery: b.policy?.acceptsPayOnDelivery ?? false,
      returnWindowDays: b.policy?.returnWindowDays ?? 7,
      delivery,
      method,
    };
  });

  const commissionRules = await tx.commissionRule.findMany({
    where: { OR: [{ scope: "global" }, { scope: "category" }, { scope: "business", businessId: { in: businessIds } }], effectiveFrom: { lte: now } },
  });
  const deliveryKobo = new Map(sellers.map((s) => [s.businessId, s.method === "delivery" && s.delivery ? s.delivery.feeKobo : 0n]));
  const quote = buildQuote({
    lines: sellable.map((l) => ({ key: l.cartItemId, businessId: l.businessId, categoryId: l.categoryId, parentCategoryId: l.parentCategoryId })),
    priced,
    deliveryKobo,
    commissionRules,
    defaultCommissionBps: settings.defaultCommissionBps,
    serviceFeeBps: settings.serviceFeeBps,
    serviceFeeCapKobo: settings.serviceFeeCapKobo,
    vatBps: settings.vatBps,
    now,
  });

  const blockers: string[] = [];
  if (lines.length === 0) blockers.push("Your cart is empty.");
  if (lines.some((l) => l.problem)) blockers.push("Some items need your attention before you can check out.");
  if (input.address) {
    for (const s of sellers) if (!s.method) blockers.push(`${s.name} doesn't deliver to this address and doesn't offer pickup.`);
  }

  return {
    now,
    settings,
    lines,
    saved,
    priced,
    sellers,
    quote,
    couponCode,
    payOnDeliveryAvailable: settings.payOnDeliveryEnabled && sellers.length > 0 && sellers.every((s) => s.acceptsPayOnDelivery),
    hasAddress: input.address !== null,
    blockers,
  };
}
