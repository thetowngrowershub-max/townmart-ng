import type { PayoutStatus } from "@prisma/client";
import { formatDate, formatDateTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { getCheckoutSettings } from "@/lib/settings";
import { businessBalances } from "./balances";
import { lagosMonth, monthRange } from "./statement";

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = { pending: "Starting", processing: "On its way", paid: "Paid", failed: "Failed, back in your balance" };

export type SellerPayoutsView = {
  escrow: string;
  available: string;
  availableKobo: string;
  minimum: string;
  nextRelease: { at: string; amount: string } | null;
  thisMonth: { sales: string; commission: string; refunds: string; paidOut: string };
  bank: { name: string; last4: string; accountName: string; ready: boolean } | null;
  approved: boolean;
  inFlight: boolean;
  payouts: { id: string; reference: string; amount: string; status: PayoutStatus; statusLabel: string; bank: string; createdAt: string; paidAt: string | null; failureReason: string | null }[];
  months: { value: string; label: string }[];
};

/** The seller's money page: balances, what's coming, bank account and payout history. Seller RLS transaction. */
export async function loadSellerPayouts(tx: Tx, businessId: string, now = new Date()): Promise<SellerPayoutsView> {
  const business = await tx.business.findUniqueOrThrow({ where: { id: businessId }, select: { status: true, createdAt: true, payoutAccount: true } });
  const bal = await businessBalances(tx, businessId);
  const settings = await getCheckoutSettings(tx);
  const next = await tx.sellerOrder.findFirst({ where: { businessId, escrowReleasedAt: null, escrowReleaseAt: { not: null }, payOnDelivery: false }, orderBy: { escrowReleaseAt: "asc" }, select: { escrowReleaseAt: true } });
  let nextRelease: SellerPayoutsView["nextRelease"] = null;
  if (next?.escrowReleaseAt) {
    // Everything due by the end of that Lagos day.
    const dayEnd = new Date(lagosDayEnd(next.escrowReleaseAt));
    const due = await tx.sellerOrder.findMany({ where: { businessId, escrowReleasedAt: null, payOnDelivery: false, escrowReleaseAt: { lte: dayEnd } }, select: { sellerNetKobo: true, payLaterKobo: true } });
    // Before any refunds still to come.
    const kobo = due.reduce((a, s) => a + s.sellerNetKobo - s.payLaterKobo, 0n);
    nextRelease = { at: formatDateTime(next.escrowReleaseAt), amount: formatPrice(kobo) };
  }

  const month = lagosMonth(now);
  const range = monthRange(month)!;
  const sums = await tx.$queryRaw<{ kind: string; delta: bigint }[]>`
    SELECT t.kind, sum(e.credit_kobo - e.debit_kobo)::bigint AS delta
      FROM ledger_entries e
      JOIN ledger_accounts a ON a.id = e.account_id
      JOIN ledger_transactions t ON t.id = e.transaction_id
     WHERE e.business_id = ${businessId}::uuid AND a.owner_type = 'business'
       AND e.created_at >= ${range.from} AND e.created_at < ${range.to}
     GROUP BY t.kind`;
  const k = (kind: string) => sums.find((s) => s.kind === kind)?.delta ?? 0n;
  const commission = await tx.sellerOrder.aggregate({ where: { businessId, escrowReleasedAt: { gte: range.from, lt: range.to } }, _sum: { commissionKobo: true } });

  const payouts = await tx.payout.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 50 });
  const months: SellerPayoutsView["months"] = [];
  for (let m = month; m >= lagosMonth(business.createdAt) && months.length < 24; m = prevMonth(m)) {
    months.push({ value: m, label: new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(monthRange(m)!.from) });
  }
  const acct = business.payoutAccount;
  return {
    escrow: formatPrice(bal.escrowKobo),
    available: formatPrice(bal.availableKobo),
    availableKobo: bal.availableKobo.toString(),
    minimum: formatPrice(settings.payoutMinimumKobo),
    nextRelease,
    thisMonth: { sales: formatPrice(k("payment_captured")), commission: formatPrice(commission._sum.commissionKobo ?? 0n), refunds: formatPrice(-k("refund_approved")), paidOut: formatPrice(-(k("payout") + k("payout_returned"))) },
    bank: acct ? { name: acct.bankName, last4: acct.accountNumberLast4, accountName: acct.accountName, ready: !!acct.verifiedAt && !!acct.providerRecipientCode } : null,
    approved: business.status === "approved",
    inFlight: payouts.some((p) => p.status === "pending" || p.status === "processing"),
    payouts: payouts.map((p) => ({
      id: p.id,
      reference: p.reference,
      amount: formatPrice(p.amountKobo),
      status: p.status,
      statusLabel: PAYOUT_STATUS_LABELS[p.status],
      bank: `${p.bankName} ••••${p.accountNumberLast4}`,
      createdAt: formatDateTime(p.createdAt),
      paidAt: p.paidAt ? formatDate(p.paidAt) : null,
      failureReason: p.failureReason,
    })),
    months,
  };
}

function prevMonth(m: string) {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
}

/** The end of the Lagos day `d` falls in. */
function lagosDayEnd(d: Date) {
  const day = new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);
  return new Date(`${day}T23:59:59.999+01:00`).getTime();
}
