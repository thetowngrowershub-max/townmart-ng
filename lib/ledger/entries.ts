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
