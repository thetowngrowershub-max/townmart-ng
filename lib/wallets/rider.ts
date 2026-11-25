import type { PayoutStatus } from "@prisma/client";
import { formatDate, formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { riderEarningPostings, riderWalletOf } from "@/lib/ledger/entries";
import { postLedgerTransaction } from "@/lib/ledger/post";
import { formatPrice } from "@/lib/money";
import { recipientUsable } from "@/lib/payments/transfers";
import { PAYOUT_STATUS_LABELS, PAYOUT_STATUS_TONE } from "@/lib/payouts/seller-view";
import { lagosMonth, monthRange } from "@/lib/payouts/statement";
import { getCheckoutSettings } from "@/lib/settings";

/**
 * TownMart pool rider wallets. A pool rider (Rider.businessId NULL) is paid
 * for each delivery out of the order's delivery fee: their share lands in
 * their wallet when the order is delivered, and TownMart keeps the rest.
 * Shop riders are paid by their shop and have no wallet.
 *
 * The wallet is a ledger account (owner type "rider", keyed by the rider id),
 * so it's append-only and balances with everything else. Payouts from it work
 * like a shop's (lib/payouts/payouts.ts).
 */

export class RiderWalletError extends Error {}

/**
 * Credits a pool rider for delivering a seller order. Call it inside the
 * (system-scope) transaction that marks the order delivered. The whole
 * delivery fee leaves the seller's side: from escrow while the order's money
 * is still held, otherwise (pay on delivery, or already released) from their
 * available balance. Safe to call twice: the second call writes nothing.
 * Returns false if it was already credited.
 */
export async function creditRiderEarning(tx: Tx, p: { riderId: string; sellerOrderId: string; amountKobo: bigint; memo?: string }): Promise<boolean> {
  const so = await tx.sellerOrder.findUniqueOrThrow({
    where: { id: p.sellerOrderId },
    select: { id: true, businessId: true, orderNumber: true, deliveryKobo: true, payOnDelivery: true, escrowReleasedAt: true, riderId: true },
  });
  if (so.riderId !== p.riderId) throw new RiderWalletError(`Rider ${p.riderId} isn't the rider on ${so.orderNumber}`);
  const rider = await tx.rider.findUniqueOrThrow({ where: { id: p.riderId }, select: { businessId: true } });
  if (rider.businessId !== null) throw new RiderWalletError("Only TownMart pool riders have a wallet; shop riders are paid by their shop");
  if (p.amountKobo <= 0n || so.deliveryKobo <= 0n) return false;
  const riderPayKobo = p.amountKobo > so.deliveryKobo ? so.deliveryKobo : p.amountKobo;
  return postLedgerTransaction(tx, {
    kind: "rider_earning",
    referenceType: "seller_order",
    referenceId: so.id,
    memo: p.memo ?? `${so.orderNumber}: delivery`,
    postings: riderEarningPostings({
      businessId: so.businessId,
      from: so.payOnDelivery || so.escrowReleasedAt ? "available" : "escrow",
      riderId: p.riderId,
      deliveryKobo: so.deliveryKobo,
      riderPayKobo,
    }),
  });
}

/** A pool rider's wallet balance (what they can be paid out), from the ledger. */
export async function riderBalance(tx: Tx, riderId: string): Promise<bigint> {
  const rows = await tx.$queryRaw<{ balance: bigint }[]>`
    SELECT coalesce(sum(e.credit_kobo - e.debit_kobo), 0)::bigint AS balance
      FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
     WHERE a.owner_type = 'rider' AND a.owner_key = ${riderId} AND a.type = 'available'`;
  return rows[0]?.balance ?? 0n;
}

export type RiderWalletEntry = { at: Date; kind: string; memo: string | null; kobo: bigint; referenceType: string; referenceId: string };

/** The rider's wallet history, newest first: earnings (+) and payouts (−). */
export async function riderWalletEntries(tx: Tx, riderId: string, take = 100): Promise<RiderWalletEntry[]> {
  const acct = riderWalletOf(riderId);
  const rows = await tx.$queryRaw<{ at: Date; kind: string; memo: string | null; kobo: bigint; reference_type: string; reference_id: string }[]>`
    SELECT e.created_at AS at, t.kind, t.memo, (e.credit_kobo - e.debit_kobo)::bigint AS kobo, e.reference_type, e.reference_id::text
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      JOIN ledger_transactions t ON t.id = e.transaction_id
     WHERE a.owner_type = 'rider' AND a.owner_key = ${acct.riderId} AND a.type = 'available'
     ORDER BY e.created_at DESC, e.id DESC
     LIMIT ${take}`;
  return rows.map((r) => ({ at: r.at, kind: r.kind, memo: r.memo, kobo: r.kobo, referenceType: r.reference_type, referenceId: r.reference_id }));
}

const ENTRY_LABELS: Record<string, string> = { rider_earning: "Delivery", payout: "Payout to your bank", payout_returned: "Payout returned to your wallet" };

export type RiderWalletView = {
  balance: string;
  balanceKobo: string;
  thisMonth: { earned: string; deliveries: number; paidOut: string };
  bank: { name: string; last4: string; accountName: string; ready: boolean } | null;
  inFlight: boolean;
  needsApproval: boolean;
  minimum: string;
  entries: { at: string; label: string; memo: string | null; amount: string; credit: boolean }[];
  payouts: { id: string; reference: string; amount: string; status: PayoutStatus; statusLabel: string; tone: "info" | "success" | "danger" | "warning"; bank: string; createdAt: string; paidAt: string | null; failureReason: string | null }[];
};

/** Everything on the rider's wallet page. System scope (rider wallets have no shop for RLS). */
export async function loadRiderWallet(tx: Tx, riderId: string, now = new Date()): Promise<RiderWalletView> {
  const [balance, entries, rider, settings] = await Promise.all([
    riderBalance(tx, riderId),
    riderWalletEntries(tx, riderId, 50),
    tx.rider.findUniqueOrThrow({ where: { id: riderId }, include: { payoutAccount: true, payouts: { orderBy: { createdAt: "desc" }, take: 30 } } }),
    getCheckoutSettings(tx),
  ]);
  const range = monthRange(lagosMonth(now))!;
  const [month] = await tx.$queryRaw<{ earned: bigint; deliveries: bigint }[]>`
    SELECT coalesce(sum(e.credit_kobo) FILTER (WHERE t.kind = 'rider_earning'), 0)::bigint AS earned,
           count(*) FILTER (WHERE t.kind = 'rider_earning') AS deliveries
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      JOIN ledger_transactions t ON t.id = e.transaction_id
     WHERE a.owner_type = 'rider' AND a.owner_key = ${riderId} AND a.type = 'available'
       AND e.created_at >= ${range.from} AND e.created_at < ${range.to}`;
  const acct = rider.payoutAccount;
  return {
    balance: formatPrice(balance),
    balanceKobo: balance.toString(),
    thisMonth: {
      earned: formatPrice(month?.earned ?? 0n),
      deliveries: Number(month?.deliveries ?? 0n),
      // Only payouts that reached the bank, not ones waiting or on their way.
      paidOut: formatPrice(rider.payouts.filter((p) => p.status === "paid" && p.paidAt && p.paidAt >= range.from && p.paidAt < range.to).reduce((a, p) => a + p.amountKobo, 0n)),
    },
    bank: acct ? { name: acct.bankName, last4: acct.accountNumberLast4, accountName: acct.accountName, ready: recipientUsable(acct) } : null,
    inFlight: rider.payouts.some((p) => p.status === "awaiting_approval" || p.status === "pending" || p.status === "processing"),
    needsApproval: settings.payoutRequireApproval,
    minimum: formatPrice(settings.payoutMinimumKobo),
    entries: entries.map((e) => ({ at: formatDateTime(e.at), label: ENTRY_LABELS[e.kind] ?? e.kind, memo: e.memo, amount: formatPrice(e.kobo < 0n ? -e.kobo : e.kobo), credit: e.kobo >= 0n })),
    payouts: rider.payouts.map((p) => ({
      id: p.id,
      reference: p.reference,
      amount: formatPrice(p.amountKobo),
      status: p.status,
      statusLabel: PAYOUT_STATUS_LABELS[p.status].replace("your balance", "your wallet"),
      tone: PAYOUT_STATUS_TONE[p.status],
      bank: `${p.bankName} ••••${p.accountNumberLast4}`,
      createdAt: formatDateTime(p.createdAt),
      paidAt: p.paidAt ? formatDate(p.paidAt) : null,
      failureReason: p.failureReason,
    })),
  };
}
