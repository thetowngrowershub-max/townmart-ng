import type { Tx } from "@/lib/db";

/**
 * Platform settings that admins change from the console (Phase 7). Each has a
 * code default, so a missing or malformed row never breaks checkout.
 */
export type CheckoutSettings = {
  stockHoldMinutes: number;
  payOnDeliveryEnabled: boolean;
  /** Service fee charged to the shopper: percent of goods after discounts, in basis points, capped. */
  serviceFeeBps: number;
  serviceFeeCapKobo: bigint;
  /** VAT on TownMart's service fee, in basis points (750 = 7.5%). */
  vatBps: number;
  /** Commission when no commission rule applies, in basis points. */
  defaultCommissionBps: number;
  escrowReleaseDays: number;
  /** How soon a booking can start, and how far ahead it can be made. */
  bookingLeadMinutes: number;
  bookingDaysAhead: number;
  /** Delivered orders the customer hasn't confirmed are completed after this many days. */
  autoCompleteDays: number;
  /** A seller has this long to answer a refund request before it goes to TownMart. */
  refundResponseHours: number;
  /** Share of a booking refunded when the customer cancels less than 24 hours before the start. */
  lateCancelRefundPercent: number;
  /** Smallest available balance paid out automatically (sellers can ask for any positive amount). */
  payoutMinimumKobo: bigint;
};

export const CHECKOUT_DEFAULTS: CheckoutSettings = {
  stockHoldMinutes: 15,
  payOnDeliveryEnabled: true,
  serviceFeeBps: 100,
  serviceFeeCapKobo: 100_000n,
  vatBps: 750,
  defaultCommissionBps: 500,
  escrowReleaseDays: 3,
  bookingLeadMinutes: 120,
  bookingDaysAhead: 60,
  autoCompleteDays: 7,
  refundResponseHours: 48,
  lateCancelRefundPercent: 50,
  payoutMinimumKobo: 100_000n,
};

const KEYS = [
  "checkout.stock_hold_minutes",
  "payments.pay_on_delivery_enabled",
  "fees.service_fee_percent",
  "fees.service_fee_cap_naira",
  "fees.vat_percent",
  "commission.default_percent",
  "escrow.release_days",
  "bookings.lead_minutes",
  "bookings.days_ahead",
  "orders.auto_complete_days",
  "refunds.seller_response_hours",
  "refunds.late_cancel_percent",
  "payouts.minimum_naira",
] as const;

const num = (v: unknown, min: number, max: number): number | undefined => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined);

export async function getCheckoutSettings(tx: Tx): Promise<CheckoutSettings> {
  const rows = await tx.setting.findMany({ where: { key: { in: [...KEYS] } } });
  const v = new Map(rows.map((r) => [r.key, r.value as unknown]));
  const d = CHECKOUT_DEFAULTS;
  const percentToBps = (p: number | undefined, fallback: number) => (p === undefined ? fallback : Math.round(p * 100));
  const cap = num(v.get("fees.service_fee_cap_naira"), 0, 1_000_000);
  const payoutMin = num(v.get("payouts.minimum_naira"), 0, 10_000_000);
  return {
    stockHoldMinutes: num(v.get("checkout.stock_hold_minutes"), 5, 120) ?? d.stockHoldMinutes,
    payOnDeliveryEnabled: typeof v.get("payments.pay_on_delivery_enabled") === "boolean" ? (v.get("payments.pay_on_delivery_enabled") as boolean) : d.payOnDeliveryEnabled,
    serviceFeeBps: percentToBps(num(v.get("fees.service_fee_percent"), 0, 20), d.serviceFeeBps),
    serviceFeeCapKobo: cap === undefined ? d.serviceFeeCapKobo : BigInt(Math.round(cap * 100)),
    vatBps: percentToBps(num(v.get("fees.vat_percent"), 0, 50), d.vatBps),
    defaultCommissionBps: percentToBps(num(v.get("commission.default_percent"), 0, 50), d.defaultCommissionBps),
    escrowReleaseDays: num(v.get("escrow.release_days"), 0, 60) ?? d.escrowReleaseDays,
    bookingLeadMinutes: num(v.get("bookings.lead_minutes"), 0, 7 * 24 * 60) ?? d.bookingLeadMinutes,
    bookingDaysAhead: num(v.get("bookings.days_ahead"), 1, 365) ?? d.bookingDaysAhead,
    autoCompleteDays: num(v.get("orders.auto_complete_days"), 1, 60) ?? d.autoCompleteDays,
    refundResponseHours: num(v.get("refunds.seller_response_hours"), 1, 14 * 24) ?? d.refundResponseHours,
    lateCancelRefundPercent: num(v.get("refunds.late_cancel_percent"), 0, 100) ?? d.lateCancelRefundPercent,
    payoutMinimumKobo: payoutMin === undefined ? d.payoutMinimumKobo : BigInt(Math.round(payoutMin * 100)),
  };
}
