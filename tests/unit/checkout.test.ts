import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteDelivery, zoneFor, type Rate, type Zone } from "@/lib/checkout/delivery";
import { buildQuote, commissionRuleFor, roundBps, type CommissionRuleLite, type QuoteLine } from "@/lib/checkout/quote";
import { assertBalanced, LedgerError, paymentCapturedPostings, type Posting } from "@/lib/ledger/entries";
import { FlutterwaveProvider } from "@/lib/payments/flutterwave";
import { PaystackProvider } from "@/lib/payments/paystack";
import type { PricedCart, PricedLine } from "@/lib/pricing";

const LAGOS = 25;
const IKEJA = 501;
const EPE = 502;

const zones: Zone[] = [
  { id: "central", name: "Central Lagos", stateIds: [], lgaIds: [IKEJA], priority: 10 },
  { id: "lagos", name: "Lagos", stateIds: [LAGOS], lgaIds: [], priority: 20 },
  { id: "sw", name: "South West", stateIds: [LAGOS, 31], lgaIds: [], priority: 30 },
];
const rate = (zoneId: string, feeKobo: bigint, extra: Partial<Rate> = {}): Rate => ({
  zoneId,
  businessId: null,
  minWeightG: 0,
  maxWeightG: 5_000,
  feeKobo,
  freeOverKobo: null,
  etaDaysMin: 1,
  etaDaysMax: 2,
  ...extra,
});

describe("delivery zones and rates", () => {
  it("prefers a zone naming the LGA, then the lowest priority state zone", () => {
    expect(zoneFor(zones, LAGOS, IKEJA)?.id).toBe("central");
    expect(zoneFor(zones, LAGOS, EPE)?.id).toBe("lagos");
    expect(zoneFor(zones, 31, 900)?.id).toBe("sw");
    expect(zoneFor(zones, 1, 1)).toBeNull();
  });

  const base = { zones, businessId: "s1", stateId: LAGOS, lgaId: EPE, weightG: 1_000, goodsKobo: 500_000n };

  it("picks the weight band and quotes its fee", () => {
    const rates = [rate("lagos", 150_000n), rate("lagos", 300_000n, { minWeightG: 5_000, maxWeightG: null })];
    expect(quoteDelivery({ ...base, rates })?.feeKobo).toBe(150_000n);
    expect(quoteDelivery({ ...base, rates, weightG: 8_000 })?.feeKobo).toBe(300_000n);
  });

  it("makes delivery free over the threshold", () => {
    const rates = [rate("lagos", 150_000n, { freeOverKobo: 2_000_000n })];
    expect(quoteDelivery({ ...base, rates })).toMatchObject({ feeKobo: 150_000n, free: false });
    expect(quoteDelivery({ ...base, rates, goodsKobo: 2_000_000n })).toMatchObject({ feeKobo: 0n, free: true });
  });

  it("lets a seller's own rates replace TownMart's for that zone", () => {
    const rates = [rate("lagos", 150_000n), rate("lagos", 80_000n, { businessId: "s1", maxWeightG: 2_000 })];
    expect(quoteDelivery({ ...base, rates })?.feeKobo).toBe(80_000n);
    // Over the seller's heaviest band there's no fallback to the default: they don't deliver that.
    expect(quoteDelivery({ ...base, rates, weightG: 3_000 })).toBeNull();
    expect(quoteDelivery({ ...base, rates, businessId: "s2" })?.feeKobo).toBe(150_000n);
  });

  it("returns null where nobody delivers", () => {
    expect(quoteDelivery({ ...base, rates: [rate("central", 1n)] })).toBeNull();
  });
});

describe("order quote", () => {
  const now = new Date("2026-11-01T09:00:00+01:00");
  const line = (key: string, businessId: string, categoryId = "cat", parentCategoryId: string | null = "parent"): QuoteLine => ({ key, businessId, categoryId, parentCategoryId });
  const priced = (lines: PricedLine[]): PricedCart => ({
    lines,
    subtotalKobo: lines.reduce((a, l) => a + l.subtotalKobo, 0n),
    discountKobo: lines.reduce((a, l) => a + l.discountKobo, 0n),
    totalKobo: lines.reduce((a, l) => a + l.totalKobo, 0n),
    coupon: { state: "none" } as PricedCart["coupon"],
    redemptions: [],
  });
  const pl = (key: string, subtotalKobo: bigint, parts: PricedLine["parts"] = []): PricedLine => {
    const discountKobo = parts.reduce((a, p) => a + p.discountKobo, 0n);
    return { key, subtotalKobo, discountKobo, totalKobo: subtotalKobo - discountKobo, promotions: [], parts };
  };
  const settings = { defaultCommissionBps: 500, serviceFeeBps: 100, serviceFeeCapKobo: 100_000n, vatBps: 750, now };

  it("rounds basis points half up", () => {
    expect(roundBps(10_050n, 100)).toBe(101n);
    expect(roundBps(10_049n, 100)).toBe(100n);
  });

  it("chooses the most specific commission rule in force", () => {
    const rules: CommissionRuleLite[] = [
      { scope: "global", categoryId: null, businessId: null, percentBps: 500, fixedKobo: 0n, effectiveFrom: new Date(0) },
      { scope: "category", categoryId: "parent", businessId: null, percentBps: 700, fixedKobo: 0n, effectiveFrom: new Date(0) },
      { scope: "category", categoryId: "cat", businessId: null, percentBps: 800, fixedKobo: 0n, effectiveFrom: new Date("2027-01-01") },
      { scope: "business", categoryId: null, businessId: "vip", percentBps: 300, fixedKobo: 0n, effectiveFrom: new Date(0) },
    ];
    expect(commissionRuleFor(rules, line("1", "vip"), now, 500).percentBps).toBe(300);
    // The category's own rule isn't in force yet, so the parent's applies.
    expect(commissionRuleFor(rules, line("1", "x"), now, 500).percentBps).toBe(700);
    expect(commissionRuleFor(rules, line("1", "x", "other", null), now, 500).percentBps).toBe(500);
    expect(commissionRuleFor([], line("1", "x"), now, 450).percentBps).toBe(450);
  });

  it("totals two sellers with delivery, a capped service fee and VAT on the fee", () => {
    const q = buildQuote({
      ...settings,
      lines: [line("a", "s1"), line("b", "s2")],
      priced: priced([pl("a", 6_000_000n), pl("b", 5_000_000n)]),
      deliveryKobo: new Map([["s1", 150_000n]]),
      commissionRules: [],
    });
    expect(q.subtotalKobo).toBe(11_000_000n);
    expect(q.deliveryKobo).toBe(150_000n);
    expect(q.serviceFeeKobo).toBe(100_000n); // 1% would be ₦1,100: capped at ₦1,000
    expect(q.vatKobo).toBe(7_500n);
    expect(q.totalKobo).toBe(11_000_000n + 150_000n + 100_000n + 7_500n);
    const s1 = q.sellers.find((s) => s.businessId === "s1")!;
    expect(s1.commissionKobo).toBe(300_000n);
    expect(s1.sellerNetKobo).toBe(6_000_000n + 150_000n - 300_000n);
  });

  it("charges the seller for its own discounts but not for TownMart's", () => {
    const q = buildQuote({
      ...settings,
      lines: [line("a", "s1")],
      priced: priced([
        pl("a", 1_000_000n, [
          { promotionId: "p1", fundedBy: "s1", discountKobo: 100_000n },
          { promotionId: "p2", fundedBy: null, discountKobo: 50_000n },
        ]),
      ]),
      deliveryKobo: new Map(),
      commissionRules: [],
    });
    const s = q.sellers[0]!;
    expect(s.discountKobo).toBe(150_000n);
    expect(s.platformDiscountKobo).toBe(50_000n);
    // Commission on what the seller is paid for: ₦9,000 at 5%.
    expect(s.commissionKobo).toBe(45_000n);
    expect(s.sellerNetKobo).toBe(900_000n - 45_000n);
    expect(q.totalKobo).toBe(850_000n + 8_500n + 638n);
  });
});

describe("ledger postings", () => {
  it("balances a captured payment and keeps each seller's net in its escrow", () => {
    const q = buildQuote({
      lines: [
        { key: "a", businessId: "s1", categoryId: "c", parentCategoryId: null },
        { key: "b", businessId: "s2", categoryId: "c", parentCategoryId: null },
      ],
      priced: {
        lines: [
          { key: "a", subtotalKobo: 1_000_000n, discountKobo: 150_000n, totalKobo: 850_000n, promotions: [], parts: [{ promotionId: "p1", fundedBy: "s1", discountKobo: 100_000n }, { promotionId: "p2", fundedBy: null, discountKobo: 50_000n }] },
          { key: "b", subtotalKobo: 333_333n, discountKobo: 0n, totalKobo: 333_333n, promotions: [], parts: [] },
        ],
        subtotalKobo: 1_333_333n,
        discountKobo: 150_000n,
        totalKobo: 1_183_333n,
        coupon: { state: "none" } as PricedCart["coupon"],
        redemptions: [],
      },
      deliveryKobo: new Map([["s1", 150_000n], ["s2", 0n]]),
      commissionRules: [],
      defaultCommissionBps: 500,
      serviceFeeBps: 100,
      serviceFeeCapKobo: 100_000n,
      vatBps: 750,
      now: new Date(),
    });
    const postings = paymentCapturedPostings({ provider: "paystack", totalKobo: q.totalKobo, serviceFeeKobo: q.serviceFeeKobo, vatKobo: q.vatKobo, sellers: q.sellers });
    const sum = (f: (p: Posting) => bigint) => postings.reduce((a, p) => a + f(p), 0n);
    expect(sum((p) => p.debitKobo)).toBe(sum((p) => p.creditKobo));
    const clearing = postings.find((p) => p.account.ownerType === "provider_clearing")!;
    expect(clearing.debitKobo).toBe(q.totalKobo);
    for (const s of q.sellers) {
      const escrow = postings.find((p) => p.account.ownerType === "business" && p.account.businessId === s.businessId)!;
      expect(escrow.creditKobo).toBe(s.sellerNetKobo);
    }
    expect(postings.find((p) => p.account.ownerType === "platform" && p.account.type === "promotions")?.debitKobo).toBe(50_000n);
  });

  it("refuses unbalanced or malformed postings", () => {
    const acc = { ownerType: "platform", type: "fees" } as const;
    expect(() => assertBalanced([{ account: acc, debitKobo: 10n, creditKobo: 0n }])).toThrow(LedgerError);
    expect(() => assertBalanced([{ account: acc, debitKobo: 10n, creditKobo: 10n }])).toThrow(LedgerError);
    expect(() => assertBalanced([{ account: acc, debitKobo: -5n, creditKobo: 0n }])).toThrow(LedgerError);
  });
});

describe("payment webhooks", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("checks Paystack's HMAC-SHA512 signature", () => {
    const p = new PaystackProvider("sk_test_secret");
    const body = JSON.stringify({ event: "charge.success", data: { id: 42, reference: "TM-1" } });
    const sig = createHmac("sha512", "sk_test_secret").update(body).digest("hex");
    expect(p.verifyWebhook(body, new Headers({ "x-paystack-signature": sig }))).toBe(true);
    expect(p.verifyWebhook(`${body} `, new Headers({ "x-paystack-signature": sig }))).toBe(false);
    expect(p.verifyWebhook(body, new Headers())).toBe(false);
    expect(p.parseWebhook(body)).toMatchObject({ eventId: "charge.success:42", reference: "TM-1", isChargeSuccess: true });
  });

  it("checks Flutterwave's verif-hash and refuses everything when none is configured", () => {
    const body = JSON.stringify({ event: "charge.completed", data: { id: 7, tx_ref: "TM-2", status: "successful" } });
    expect(new FlutterwaveProvider("k", "hash123").verifyWebhook(body, new Headers({ "verif-hash": "hash123" }))).toBe(true);
    expect(new FlutterwaveProvider("k", "hash123").verifyWebhook(body, new Headers({ "verif-hash": "hash124" }))).toBe(false);
    expect(new FlutterwaveProvider("k", undefined).verifyWebhook(body, new Headers({ "verif-hash": "" }))).toBe(false);
    expect(new FlutterwaveProvider("k", "h").parseWebhook(body)).toMatchObject({ eventId: "charge.completed:7", reference: "TM-2", isChargeSuccess: true });
  });

  it("reads Paystack's verify response in kobo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: true, message: "ok", data: { status: "success", amount: 1_017_575, currency: "NGN", channel: "card", paid_at: "2026-11-01T08:00:00Z", reference: "TM-1" } })));
    const v = await new PaystackProvider("sk").verify("TM-1");
    expect(v).toMatchObject({ status: "success", amountKobo: 1_017_575n, currency: "NGN", channel: "card" });
  });

  it("converts Flutterwave's naira amounts to kobo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "success", message: "ok", data: { status: "successful", amount: 10175.75, currency: "NGN", payment_type: "bank_transfer", created_at: "2026-11-01T08:00:00Z", tx_ref: "TM-2" } })));
    const v = await new FlutterwaveProvider("k", "h").verify("TM-2");
    expect(v).toMatchObject({ status: "success", amountKobo: 1_017_575n });
  });
});
