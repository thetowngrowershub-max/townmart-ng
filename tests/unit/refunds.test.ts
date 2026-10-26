import { describe, expect, it } from "vitest";
import {
  allocate,
  assertBalanced,
  escrowReleasePostings,
  payoutPostings,
  payoutReturnedPostings,
  podSettlementPostings,
  refundApprovedPostings,
  refundPaidPostings,
  unappliedPaymentPostings,
  LedgerError,
} from "@/lib/ledger/entries";
import { bookingRefundPercent, feeRefund, itemRefund, paidOnline, percentOf, refundSplit, returnWindow, RefundError } from "@/lib/refunds/math";
import { lagosMonth, monthRange, statementCsv, type Statement } from "@/lib/payouts/statement";

const so = { subtotalKobo: 900_000n, discountKobo: 100_000n, platformDiscountKobo: 40_000n, deliveryKobo: 150_000n, commissionKobo: 42_000n, payLaterKobo: 0n };
const none = { amountKobo: 0n, commissionKobo: 0n, platformDiscountKobo: 0n };
const net = so.subtotalKobo - (so.discountKobo - so.platformDiscountKobo) + so.deliveryKobo - so.commissionKobo;

describe("refund split", () => {
  it("takes back exactly the seller's net and returns exactly the commission when everything is refunded", () => {
    const s = refundSplit(so, none, paidOnline(so));
    expect(s.commissionReturnedKobo).toBe(so.commissionKobo);
    expect(s.platformDiscountReturnedKobo).toBe(so.platformDiscountKobo);
    expect(s.sellerDebitKobo).toBe(net);
  });

  it("adds up to the same totals when refunded in awkward pieces", () => {
    const paid = paidOnline(so);
    const pieces = [33_333n, 1n, 250_001n];
    pieces.push(paid - pieces.reduce((a, b) => a + b, 0n));
    let before = { ...none };
    let debit = 0n;
    for (const amount of pieces) {
      const s = refundSplit(so, before, amount);
      expect(s.commissionReturnedKobo).toBeGreaterThanOrEqual(0n);
      debit += s.sellerDebitKobo;
      before = { amountKobo: before.amountKobo + amount, commissionKobo: before.commissionKobo + s.commissionReturnedKobo, platformDiscountKobo: before.platformDiscountKobo + s.platformDiscountReturnedKobo };
    }
    expect(before.commissionKobo).toBe(so.commissionKobo);
    expect(debit).toBe(net);
  });

  it("refuses more than is left", () => {
    expect(() => refundSplit(so, { ...none, amountKobo: 1n }, paidOnline(so))).toThrow(RefundError);
  });

  it("leaves a booking balance paid on the day out of what can be refunded", () => {
    expect(paidOnline({ ...so, payLaterKobo: 300_000n })).toBe(paidOnline(so) - 300_000n);
  });
});

describe("item refunds", () => {
  it("refunds whole units and settles rounding on the last one", () => {
    const first = itemRefund({ paidKobo: 1_000n, itemQty: 3, refundedQty: 0, refundedKobo: 0n, qty: 1 });
    const second = itemRefund({ paidKobo: 1_000n, itemQty: 3, refundedQty: 1, refundedKobo: first, qty: 1 });
    const last = itemRefund({ paidKobo: 1_000n, itemQty: 3, refundedQty: 2, refundedKobo: first + second, qty: 1 });
    expect([first, second, last]).toEqual([333n, 333n, 334n]);
    expect(() => itemRefund({ paidKobo: 1_000n, itemQty: 3, refundedQty: 3, refundedKobo: 1_000n, qty: 1 })).toThrow(RefundError);
  });

  it("handles weighed goods", () => {
    expect(itemRefund({ paidKobo: 250_000n, itemQty: 2.5, refundedQty: 0, refundedKobo: 0n, qty: 0.5 })).toBe(50_000n);
  });
});

describe("refund policy", () => {
  it("refunds the service fee only with the refund that empties the order", () => {
    const base = { paidGoodsKobo: 1_000n, serviceFeeKobo: 50n, vatKobo: 4n, feeRefundedKobo: 0n };
    expect(feeRefund({ ...base, refundedGoodsKobo: 0n, thisRefundKobo: 400n })).toEqual({ feeKobo: 0n, vatKobo: 0n });
    expect(feeRefund({ ...base, refundedGoodsKobo: 400n, thisRefundKobo: 600n })).toEqual({ feeKobo: 50n, vatKobo: 4n });
    expect(feeRefund({ ...base, refundedGoodsKobo: 400n, thisRefundKobo: 600n, feeRefundedKobo: 54n })).toEqual({ feeKobo: 0n, vatKobo: 0n });
  });

  it("follows the 24-hour rule for service cancellations", () => {
    expect(bookingRefundPercent({ by: "seller", hoursBefore: 1, lateCancelPercent: 50 })).toBe(100);
    expect(bookingRefundPercent({ by: "customer", hoursBefore: 24, lateCancelPercent: 50 })).toBe(100);
    expect(bookingRefundPercent({ by: "customer", hoursBefore: 23, lateCancelPercent: 50 })).toBe(50);
    expect(bookingRefundPercent({ by: "customer", hoursBefore: 2, lateCancelPercent: 0 })).toBe(0);
    expect(percentOf(800_001n, 50)).toBe(400_000n);
  });

  it("gives perishables 24 hours and other goods the store's window", () => {
    const deliveredAt = new Date("2026-10-20T10:00:00+01:00");
    expect(returnWindow({ deliveredAt, windowDays: 7, perishable: true, now: new Date("2026-10-21T09:59:00+01:00") }).open).toBe(true);
    expect(returnWindow({ deliveredAt, windowDays: 7, perishable: true, now: new Date("2026-10-21T10:01:00+01:00") }).open).toBe(false);
    expect(returnWindow({ deliveredAt, windowDays: 7, perishable: false, now: new Date("2026-10-26T10:00:00+01:00") }).open).toBe(true);
    expect(returnWindow({ deliveredAt: null, windowDays: 7, perishable: false, now: new Date() }).open).toBe(true);
  });
});

describe("ledger postings", () => {
  const b = "00000000-0000-0000-0000-000000000001";
  const sum = (ps: ReturnType<typeof escrowReleasePostings>, type: string) => ps.filter((p) => p.account.type === type).reduce((a, p) => a + p.creditKobo - p.debitKobo, 0n);

  it("balances every Phase 5 transaction and moves money the right way", () => {
    const release = escrowReleasePostings(b, 5_000n);
    expect([sum(release, "escrow"), sum(release, "available")]).toEqual([-5_000n, 5_000n]);
    // A negative escrow (deposit smaller than commission) is moved back the other way.
    expect(sum(escrowReleasePostings(b, -300n), "available")).toBe(-300n);

    const pod = podSettlementPostings({ businessId: b, commissionKobo: 1_000n, feeKobo: 200n, vatKobo: 15n, platformDiscountKobo: 500n });
    expect(sum(pod, "available")).toBe(-715n);
    expect(sum(pod, "commission")).toBe(1_000n);

    const refund = refundApprovedPostings({ businessId: b, debitFrom: "escrow", amountKobo: 10_000n, commissionReturnedKobo: 500n, platformDiscountReturnedKobo: 200n, sellerDebitKobo: 9_700n, feeKobo: 100n, vatKobo: 7n });
    expect(sum(refund, "escrow")).toBe(-9_700n);
    expect(sum(refund, "refunds")).toBe(10_107n);
    expect(sum(refund, "commission")).toBe(-500n);
    expect(() => refundApprovedPostings({ businessId: b, debitFrom: "escrow", amountKobo: 10n, commissionReturnedKobo: 1n, platformDiscountReturnedKobo: 0n, sellerDebitKobo: 10n, feeKobo: 0n, vatKobo: 0n })).toThrow(LedgerError);

    for (const ps of [release, pod, refund, refundPaidPostings("paystack", 10_107n), unappliedPaymentPostings("paystack", 99n), payoutPostings(b, "paystack", 1n), payoutReturnedPostings(b, "paystack", 1n)]) {
      expect(() => assertBalanced(ps)).not.toThrow();
    }
  });

  it("allocates exactly, in proportion", () => {
    expect(allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n]);
    expect(allocate(7n, [0n, 0n])).toEqual([7n, 0n]);
    const parts = allocate(100_000n, [3n, 7n, 11n]);
    expect(parts.reduce((a, p) => a + p, 0n)).toBe(100_000n);
  });
});

describe("statements", () => {
  it("works in Lagos months", () => {
    expect(monthRange("2026-12")).toEqual({ from: new Date("2026-11-30T23:00:00Z"), to: new Date("2026-12-31T23:00:00Z") });
    expect(monthRange("2026-13")).toBeNull();
    expect(lagosMonth(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11");
  });

  it("writes a CSV that spreadsheets won't run as formulas", () => {
    const s: Statement = {
      month: "2026-10",
      from: new Date(),
      to: new Date(),
      opening: { escrowKobo: 0n, availableKobo: 0n },
      closing: { escrowKobo: 0n, availableKobo: -150n },
      lines: [{ at: new Date("2026-10-02T10:00:00Z"), kind: "refund_approved", label: "Refund", memo: "=HYPERLINK(\"x\")", escrowKobo: 0n, availableKobo: -150n, balanceKobo: -150n }],
      totals: { salesKobo: 0n, refundsKobo: 150n, payoutsKobo: 0n, commissionKobo: 0n },
    };
    const csv = statementCsv(s, "Shop, Ltd");
    expect(csv).toContain('"Shop, Ltd"');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain(",-1.50,-1.50");
  });
});
