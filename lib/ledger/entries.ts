/**
 * Double-entry ledger postings. Pure: builds balanced entry lists that
 * lib/ledger/post.ts writes. The database also rejects an unbalanced
 * transaction when it commits.
 */

export type AccountRef =
  | { ownerType: "platform"; type: "commission" | "fees" | "tax" | "promotions" | "refunds" }
  | { ownerType: "business"; businessId: string; type: "escrow" | "available" }
  | { ownerType: "provider_clearing"; provider: string; type: "clearing" };

export type Posting = { account: AccountRef; debitKobo: bigint; creditKobo: bigint };

export class LedgerError extends Error {}

export function assertBalanced(postings: readonly Posting[]): void {
  let d = 0n;
  let c = 0n;
  for (const p of postings) {
    if (p.debitKobo < 0n || p.creditKobo < 0n || (p.debitKobo === 0n) === (p.creditKobo === 0n)) throw new LedgerError("Each posting must be a positive debit or a positive credit");
    d += p.debitKobo;
    c += p.creditKobo;
  }
  if (d !== c) throw new LedgerError(`Unbalanced postings: debits ${d}, credits ${c}`);
}

const dr = (account: AccountRef, kobo: bigint): Posting[] => (kobo > 0n ? [{ account, debitKobo: kobo, creditKobo: 0n }] : []);
const cr = (account: AccountRef, kobo: bigint): Posting[] => (kobo > 0n ? [{ account, debitKobo: 0n, creditKobo: kobo }] : []);

export type PaidOrder = {
  provider: string;
  totalKobo: bigint;
  serviceFeeKobo: bigint;
  vatKobo: bigint;
  sellers: { businessId: string; platformDiscountKobo: bigint; commissionKobo: bigint; sellerNetKobo: bigint; payLaterKobo?: bigint }[];
};

/**
 * A captured online payment. The money sits with the payment provider
 * (clearing) until it settles to TownMart; each seller's share is held in
 * escrow until the order is delivered (released in Phase 5).
 *
 * A booking balance the customer pays the provider directly on the day
 * (payLaterKobo) is money the seller already has, so it comes off their
 * escrow credit. If it's more than their net share (a small deposit and a
 * large commission), the seller owes TownMart the difference: their escrow
 * is debited.
 *
 *   Dr provider clearing     total paid
 *   Dr platform promotions   discounts TownMart pays for
 *   Cr seller escrow         each seller's net
 *   Cr platform commission   commission
 *   Cr platform fees         service fee
 *   Cr platform tax          VAT on the service fee
 */
export function paymentCapturedPostings(o: PaidOrder): Posting[] {
  const postings: Posting[] = [
    ...dr({ ownerType: "provider_clearing", provider: o.provider, type: "clearing" }, o.totalKobo),
    ...dr({ ownerType: "platform", type: "promotions" }, o.sellers.reduce((a, s) => a + s.platformDiscountKobo, 0n)),
    ...o.sellers.flatMap((s) => {
      const escrow = s.sellerNetKobo - (s.payLaterKobo ?? 0n);
      const account = { ownerType: "business", businessId: s.businessId, type: "escrow" } as const;
      return escrow >= 0n ? cr(account, escrow) : dr(account, -escrow);
    }),
    ...cr({ ownerType: "platform", type: "commission" }, o.sellers.reduce((a, s) => a + s.commissionKobo, 0n)),
    ...cr({ ownerType: "platform", type: "fees" }, o.serviceFeeKobo),
    ...cr({ ownerType: "platform", type: "tax" }, o.vatKobo),
  ];
  assertBalanced(postings);
  return postings;
}

const escrowOf = (businessId: string) => ({ ownerType: "business", businessId, type: "escrow" }) as const;
const availableOf = (businessId: string) => ({ ownerType: "business", businessId, type: "available" }) as const;
const clearing = (provider: string) => ({ ownerType: "provider_clearing", provider, type: "clearing" }) as const;
const platform = (type: "commission" | "fees" | "tax" | "promotions" | "refunds") => ({ ownerType: "platform", type }) as const;

/** Dr `from`, Cr `to` by `kobo`; a negative amount moves the other way. */
function move(from: AccountRef, to: AccountRef, kobo: bigint): Posting[] {
  return kobo >= 0n ? [...dr(from, kobo), ...cr(to, kobo)] : [...dr(to, -kobo), ...cr(from, -kobo)];
}

/** A seller balance debited by `kobo` (credited if negative). */
const debitSigned = (account: AccountRef, kobo: bigint): Posting[] => (kobo >= 0n ? dr(account, kobo) : cr(account, -kobo));

function balanced(postings: Posting[]): Posting[] {
  assertBalanced(postings);
  return postings;
}

/**
 * Escrow release: what's left of a seller order's escrow (after any refunds
 * taken from it) becomes the seller's available balance.
 *
 *   Dr seller escrow      amount
 *   Cr seller available   amount
 */
export function escrowReleasePostings(businessId: string, kobo: bigint): Posting[] {
  return balanced(move(escrowOf(businessId), availableOf(businessId), kobo));
}

/**
 * Pay on delivery: the seller collected the whole amount, TownMart's commission
 * and service fee included, so they owe it from their available balance. A
 * discount TownMart funded is owed to them instead.
 *
 *   Dr seller available    commission + fee + VAT − TownMart-funded discount
 *   Dr platform promotions TownMart-funded discount
 *   Cr platform commission commission
 *   Cr platform fees       the order's service fee, this seller's share
 *   Cr platform tax        VAT on it
 */
export function podSettlementPostings(p: { businessId: string; commissionKobo: bigint; feeKobo: bigint; vatKobo: bigint; platformDiscountKobo: bigint }): Posting[] {
  const owed = p.commissionKobo + p.feeKobo + p.vatKobo - p.platformDiscountKobo;
  return balanced([
    ...debitSigned(availableOf(p.businessId), owed),
    ...dr(platform("promotions"), p.platformDiscountKobo),
    ...cr(platform("commission"), p.commissionKobo),
    ...cr(platform("fees"), p.feeKobo),
    ...cr(platform("tax"), p.vatKobo),
  ]);
}

export type ApprovedRefund = {
  businessId: string;
  /** escrow before the seller order's escrow is released, available after. */
  debitFrom: "escrow" | "available";
  amountKobo: bigint;
  commissionReturnedKobo: bigint;
  platformDiscountReturnedKobo: bigint;
  sellerDebitKobo: bigint;
  feeKobo: bigint;
  vatKobo: bigint;
};

/**
 * An approved refund: the money is now owed to the customer (refunds
 * payable). The seller gives back their share, TownMart its commission and
 * (when the whole order is refunded) its service fee and VAT. A discount
 * TownMart funded was never the seller's money, so it goes back to promotions.
 *
 *   Dr seller escrow|available  amount + TownMart-funded discount − commission
 *   Dr platform commission      commission on the refunded amount
 *   Dr platform fees / tax      service fee and VAT, if refunded
 *   Cr platform promotions      TownMart-funded discount on the refunded amount
 *   Cr platform refunds         everything the customer gets back
 */
export function refundApprovedPostings(r: ApprovedRefund): Posting[] {
  if (r.sellerDebitKobo !== r.amountKobo + r.platformDiscountReturnedKobo - r.commissionReturnedKobo) throw new LedgerError("Refund split doesn't add up");
  const seller = r.debitFrom === "escrow" ? escrowOf(r.businessId) : availableOf(r.businessId);
  return balanced([
    ...debitSigned(seller, r.sellerDebitKobo),
    ...dr(platform("commission"), r.commissionReturnedKobo),
    ...dr(platform("fees"), r.feeKobo),
    ...dr(platform("tax"), r.vatKobo),
    ...cr(platform("promotions"), r.platformDiscountReturnedKobo),
    ...cr(platform("refunds"), r.amountKobo + r.feeKobo + r.vatKobo),
  ]);
}

/**
 * A payment TownMart couldn't apply to an order (paid twice, the wrong
 * amount, or after the items sold out). The money arrived at the provider and
 * is owed straight back.
 *
 *   Dr provider clearing   amount
 *   Cr platform refunds    amount
 */
export function unappliedPaymentPostings(provider: string, kobo: bigint): Posting[] {
  return balanced(move(clearing(provider), platform("refunds"), kobo));
}

/**
 * The provider has paid a refund out of TownMart's balance with them.
 *
 *   Dr platform refunds    amount
 *   Cr provider clearing   amount
 */
export function refundPaidPostings(provider: string, kobo: bigint): Posting[] {
  return balanced(move(platform("refunds"), clearing(provider), kobo));
}

/**
 * A payout: the seller's available balance leaves TownMart's provider balance
 * by bank transfer. If the transfer fails, payoutReturnedPostings undoes it.
 *
 *   Dr seller available    amount
 *   Cr provider clearing   amount
 */
export function payoutPostings(businessId: string, provider: string, kobo: bigint): Posting[] {
  return balanced(move(availableOf(businessId), clearing(provider), kobo));
}

export function payoutReturnedPostings(businessId: string, provider: string, kobo: bigint): Posting[] {
  return balanced(move(clearing(provider), availableOf(businessId), kobo));
}

/**
 * Splits `total` in proportion to `weights`, in whole kobo, so the parts add
 * up exactly (largest remainder; ties go to the earlier part).
 */
export function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, w) => a + w, 0n);
  if (weights.some((w) => w < 0n)) throw new LedgerError("Weights must not be negative");
  if (sum === 0n) return weights.map((_, i) => (i === 0 ? total : 0n));
  const parts = weights.map((w) => (total * w) / sum);
  let left = total - parts.reduce((a, p) => a + p, 0n);
  const order = weights.map((w, i) => ({ i, rem: (total * w) % sum })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1));
  for (const { i } of order) {
    if (left <= 0n) break;
    parts[i]! += 1n;
    left -= 1n;
  }
  return parts;
}
