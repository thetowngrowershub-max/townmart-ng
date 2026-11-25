/**
 * Order totals. Pure, BigInt kobo, the only place checkout arithmetic happens:
 * the checkout page shows this quote and the order is written from it.
 */
import type { PricedCart } from "@/lib/pricing";

export type CommissionRuleLite = {
  scope: "global" | "category" | "business";
  categoryId: string | null;
  businessId: string | null;
  percentBps: number;
  fixedKobo: bigint;
  effectiveFrom: Date;
};

export type QuoteLine = {
  key: string;
  businessId: string;
  categoryId: string;
  parentCategoryId: string | null;
  /** Booking balance the shopper pays the provider on the day (not charged at checkout). */
  payLaterKobo?: bigint;
};

export type SellerQuote = {
  businessId: string;
  subtotalKobo: bigint;
  discountKobo: bigint;
  platformDiscountKobo: bigint;
  deliveryKobo: bigint;
  commissionKobo: bigint;
  sellerNetKobo: bigint;
  /** Booking balances paid to the provider on the day, out of totalKobo. */
  payLaterKobo: bigint;
  /** This seller's share of the order: goods after discounts plus delivery (including any pay-later balance). */
  totalKobo: bigint;
  lines: { key: string; commissionKobo: bigint }[];
};

export type OrderQuote = {
  sellers: SellerQuote[];
  subtotalKobo: bigint;
  discountKobo: bigint;
  deliveryKobo: bigint;
  serviceFeeKobo: bigint;
  vatKobo: bigint;
  payLaterKobo: bigint;
  /** Due at checkout: everything except the pay-later balances. */
  totalKobo: bigint;
};

export const roundBps = (amount: bigint, bps: number) => (amount * BigInt(bps) + 5_000n) / 10_000n;

/** Business rule, then the item's category, then its parent category, then the global rule, then the default. Latest effective rule wins at each level. */
export function commissionRuleFor(rules: readonly CommissionRuleLite[], line: QuoteLine, now: Date, defaultBps: number): { percentBps: number; fixedKobo: bigint } {
  const live = rules.filter((r) => r.effectiveFrom <= now).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  return (
    live.find((r) => r.scope === "business" && r.businessId === line.businessId) ??
    live.find((r) => r.scope === "category" && r.categoryId === line.categoryId) ??
    (line.parentCategoryId ? live.find((r) => r.scope === "category" && r.categoryId === line.parentCategoryId) : undefined) ??
    live.find((r) => r.scope === "global") ?? { percentBps: defaultBps, fixedKobo: 0n }
  );
}

export function buildQuote(params: {
  lines: readonly QuoteLine[];
  priced: PricedCart;
  deliveryKobo: ReadonlyMap<string, bigint>;
  commissionRules: readonly CommissionRuleLite[];
  defaultCommissionBps: number;
  serviceFeeBps: number;
  serviceFeeCapKobo: bigint;
  vatBps: number;
  now: Date;
}): OrderQuote {
  const priced = new Map(params.priced.lines.map((l) => [l.key, l]));
  const sellers = new Map<string, SellerQuote>();

  for (const line of params.lines) {
    const p = priced.get(line.key);
    if (!p) throw new Error(`No price for cart line ${line.key}`);
    const s =
      sellers.get(line.businessId) ??
      ({ businessId: line.businessId, subtotalKobo: 0n, discountKobo: 0n, platformDiscountKobo: 0n, deliveryKobo: 0n, commissionKobo: 0n, sellerNetKobo: 0n, payLaterKobo: 0n, totalKobo: 0n, lines: [] } satisfies SellerQuote);
    const platformDiscount = p.parts.filter((x) => x.fundedBy === null).reduce((a, x) => a + x.discountKobo, 0n);
    // The seller is paid for its goods less its own discounts; TownMart covers platform discounts.
    const sellerGoods = p.subtotalKobo - (p.discountKobo - platformDiscount);
    const rule = commissionRuleFor(params.commissionRules, line, params.now, params.defaultCommissionBps);
    let commission = roundBps(sellerGoods, rule.percentBps) + rule.fixedKobo;
    if (commission > sellerGoods) commission = sellerGoods;

    s.subtotalKobo += p.subtotalKobo;
    s.discountKobo += p.discountKobo;
    s.platformDiscountKobo += platformDiscount;
    s.commissionKobo += commission;
    s.payLaterKobo += line.payLaterKobo ?? 0n;
    s.lines.push({ key: line.key, commissionKobo: commission });
    sellers.set(line.businessId, s);
  }

  for (const s of sellers.values()) {
    s.deliveryKobo = params.deliveryKobo.get(s.businessId) ?? 0n;
    s.sellerNetKobo = s.subtotalKobo - (s.discountKobo - s.platformDiscountKobo) + s.deliveryKobo - s.commissionKobo;
    s.totalKobo = s.subtotalKobo - s.discountKobo + s.deliveryKobo;
  }

  const list = [...sellers.values()];
  const sum = (f: (s: SellerQuote) => bigint) => list.reduce((a, s) => a + f(s), 0n);
  const subtotalKobo = sum((s) => s.subtotalKobo);
  const discountKobo = sum((s) => s.discountKobo);
  const deliveryKobo = sum((s) => s.deliveryKobo);
  const payLaterKobo = sum((s) => s.payLaterKobo);
  const goods = subtotalKobo - discountKobo;
  let serviceFeeKobo = roundBps(goods, params.serviceFeeBps);
  if (serviceFeeKobo > params.serviceFeeCapKobo) serviceFeeKobo = params.serviceFeeCapKobo;
  const vatKobo = roundBps(serviceFeeKobo, params.vatBps);

  return {
    sellers: list,
    subtotalKobo,
    discountKobo,
    deliveryKobo,
    serviceFeeKobo,
    vatKobo,
    payLaterKobo,
    totalKobo: goods + deliveryKobo + serviceFeeKobo + vatKobo - payLaterKobo,
  };
}
