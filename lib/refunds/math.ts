/**
 * Refund arithmetic. Pure: lib/refunds/core.ts reads the rows, these decide
 * the amounts. All money is kobo.
 */

export class RefundError extends Error {}

type SellerOrderMoney = {
  subtotalKobo: bigint;
  discountKobo: bigint;
  platformDiscountKobo: bigint;
  deliveryKobo: bigint;
  commissionKobo: bigint;
  payLaterKobo: bigint;
};

/** What the customer paid TownMart online for one seller's part (booking balances paid on the day excluded). */
export function paidOnline(so: SellerOrderMoney): bigint {
  return so.subtotalKobo - so.discountKobo + so.deliveryKobo - so.payLaterKobo;
}

/** What the customer paid online for one order line: a booking's balance on the day isn't ours to refund. */
export function itemPaidOnline(item: { lineTotalKobo: bigint }, bookingBalanceKobo = 0n): bigint {
  const paid = item.lineTotalKobo - bookingBalanceKobo;
  return paid > 0n ? paid : 0n;
}

/**
 * The refund for `qty` of a line bought as `itemQty`, given what's already
 * been refunded for it. Rounding is settled on the last unit, so refunding a
 * line piece by piece adds up to exactly what was paid.
 */
export function itemRefund(p: { paidKobo: bigint; itemQty: number; refundedQty: number; refundedKobo: bigint; qty: number }): bigint {
  if (!(p.qty > 0) || p.refundedQty + p.qty > p.itemQty + 1e-9) throw new RefundError("That's more than was bought.");
  const after = p.refundedQty + p.qty;
  // Quantities have up to 3 decimals (weights): work in thousandths.
  const scale = (n: number) => BigInt(Math.round(n * 1000));
  const cumulative = after >= p.itemQty - 1e-9 ? p.paidKobo : (p.paidKobo * scale(after)) / scale(p.itemQty);
  return cumulative - p.refundedKobo;
}

export type RefundSplit = { commissionReturnedKobo: bigint; platformDiscountReturnedKobo: bigint; sellerDebitKobo: bigint };

/**
 * How an approved amount splits between the seller and TownMart. Commission
 * and TownMart-funded discount come back in proportion to the amount, worked
 * out on the running total so that refunding everything returns exactly the
 * commission charged and takes back exactly the seller's escrow credit.
 */
export function refundSplit(so: SellerOrderMoney, before: { amountKobo: bigint; commissionKobo: bigint; platformDiscountKobo: bigint }, amountKobo: bigint): RefundSplit {
  const paid = paidOnline(so);
  if (amountKobo < 0n || before.amountKobo + amountKobo > paid) throw new RefundError("That's more than is left to refund.");
  const after = before.amountKobo + amountKobo;
  const share = (total: bigint) => (paid === 0n ? 0n : after === paid ? total : (total * after) / paid);
  const commissionReturnedKobo = share(so.commissionKobo) - before.commissionKobo;
  const platformDiscountReturnedKobo = share(so.platformDiscountKobo) - before.platformDiscountKobo;
  return { commissionReturnedKobo, platformDiscountReturnedKobo, sellerDebitKobo: amountKobo + platformDiscountReturnedKobo - commissionReturnedKobo };
}

/**
 * TownMart's service fee and its VAT come back only with the refund that
 * leaves nothing of the order paid for: a customer who keeps part of an order
 * still used the service.
 */
export function feeRefund(p: { paidGoodsKobo: bigint; refundedGoodsKobo: bigint; thisRefundKobo: bigint; serviceFeeKobo: bigint; vatKobo: bigint; feeRefundedKobo: bigint }): { feeKobo: bigint; vatKobo: bigint } {
  const empties = p.refundedGoodsKobo + p.thisRefundKobo >= p.paidGoodsKobo && p.thisRefundKobo > 0n;
  if (!empties || p.feeRefundedKobo > 0n) return { feeKobo: 0n, vatKobo: 0n };
  return { feeKobo: p.serviceFeeKobo, vatKobo: p.vatKobo };
}

/**
 * Service cancellations under the Refund Policy: the provider cancelling, or
 * the customer cancelling 24 hours or more before the start, is a full refund;
 * a later customer cancellation refunds `lateCancelPercent`.
 */
export function bookingRefundPercent(p: { by: "seller" | "customer"; hoursBefore: number; lateCancelPercent: number }): number {
  if (p.by === "seller" || p.hoursBefore >= 24) return 100;
  return Math.max(0, Math.min(100, p.lateCancelPercent));
}

export const percentOf = (kobo: bigint, percent: number) => (kobo * BigInt(Math.round(percent * 100))) / 10_000n;

/**
 * Whether goods can still be returned. Perishables must be reported within
 * 24 hours of delivery (with a photo); everything else within the store's
 * return window (7 days by default). Not-received claims don't need delivery.
 */
export function returnWindow(p: { deliveredAt: Date | null; windowDays: number; perishable: boolean; now: Date }): { open: boolean; closesAt: Date | null } {
  if (!p.deliveredAt) return { open: true, closesAt: null };
  const ms = p.perishable ? 24 * 3_600_000 : p.windowDays * 86_400_000;
  const closesAt = new Date(p.deliveredAt.getTime() + ms);
  return { open: p.now < closesAt, closesAt };
}

export const REASON_LABELS = {
  cancelled_by_customer: "Cancelled by the customer",
  cancelled_by_seller: "Cancelled by the seller",
  booking_cancelled: "Booking cancelled",
  not_received: "Didn't arrive",
  damaged: "Arrived damaged",
  wrong_item: "Wrong item sent",
  not_as_described: "Not as described",
  changed_mind: "Changed my mind",
  provider_no_show: "Provider didn't show up",
  payment_problem: "Payment couldn't be used",
  other: "Something else",
} as const;

export const STATUS_LABELS = {
  requested: "Waiting for the seller",
  approved: "Approved",
  rejected: "Declined",
  processing: "Being paid back",
  completed: "Refunded",
  failed: "Refund delayed",
} as const;

/** Reasons a customer can give on a request, and whether a photo is required. */
export const CUSTOMER_REASONS = ["not_received", "damaged", "wrong_item", "not_as_described", "changed_mind", "provider_no_show", "other"] as const;
export type CustomerReason = (typeof CUSTOMER_REASONS)[number];
export const PHOTO_REQUIRED: ReadonlySet<CustomerReason> = new Set(["damaged", "wrong_item", "not_as_described"]);
