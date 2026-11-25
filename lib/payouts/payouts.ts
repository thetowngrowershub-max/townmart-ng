import type { Payout, PayoutStatus } from "@prisma/client";
import { withSystemContext, type Tx } from "@/lib/db";
import { payoutPostings, payoutReturnedPostings } from "@/lib/ledger/entries";
import { postLedgerTransaction } from "@/lib/ledger/post";
import { logger } from "@/lib/logger";
import { formatPrice } from "@/lib/money";
import { transferProvider, type TransferResult } from "@/lib/payments/transfers";
import { enqueueNotice } from "@/lib/queue";
import { getCheckoutSettings } from "@/lib/settings";
import { businessBalances } from "./balances";

/**
 * Payouts: a seller's whole available balance goes to their verified bank
 * account by transfer. The ledger is written when the payout is created, so
 * the balance can't be paid twice; a failed transfer is reversed back into
 * the available balance. The provider call happens outside any database
 * transaction, keyed by our payout reference so a retry can't pay twice.
 */
export class PayoutError extends Error {}

export type PayoutBlock = "not_approved" | "no_bank" | "in_flight" | "too_small";

export const PAYOUT_BLOCK_TEXT: Record<PayoutBlock, string> = {
  not_approved: "Payouts start once your store is approved.",
  no_bank: "Add and verify your bank account in Store settings to get paid.",
  in_flight: "A payout is already on its way.",
  too_small: "There's nothing to pay out yet.",
};

/**
 * Creates a payout of the business's available balance, if it can be paid:
 * approved store, verified bank account registered with the provider, nothing
 * already on its way, and at least `minimumKobo`.
 */
export async function createPayout(tx: Tx, p: { businessId: string; requestedBy: string | null; minimumKobo: bigint; now?: Date }): Promise<Payout | PayoutBlock> {
  const now = p.now ?? new Date();
  // One payout run per business at a time.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payout:${p.businessId}`}))`;
  const business = await tx.business.findUniqueOrThrow({ where: { id: p.businessId }, include: { payoutAccount: true } });
  if (business.status !== "approved") return "not_approved";
  const acct = business.payoutAccount;
  if (!acct?.verifiedAt || !acct.providerRecipientCode) return "no_bank";
  if (await tx.payout.findFirst({ where: { businessId: business.id, status: { in: ["pending", "processing"] } }, select: { id: true } })) return "in_flight";
  const { availableKobo } = await businessBalances(tx, business.id);
  if (availableKobo <= 0n || availableKobo < p.minimumKobo) return "too_small";

  const last = await tx.payout.findFirst({ where: { businessId: business.id, status: { in: ["paid", "processing"] } }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } });
  const provider = transferProvider().name;
  const payout = await tx.payout.create({
    data: {
      businessId: business.id,
      amountKobo: availableKobo,
      provider,
      reference: `PO-${now.getTime().toString(36).toUpperCase()}-${business.id.slice(-6).toUpperCase()}`,
      bankName: acct.bankName,
      accountNumberLast4: acct.accountNumberLast4,
      accountName: acct.accountName,
      periodStart: last?.periodEnd ?? business.createdAt,
      periodEnd: now,
      requestedBy: p.requestedBy,
    },
  });
  await postLedgerTransaction(tx, {
    kind: "payout",
    referenceType: "payout",
    referenceId: payout.id,
    memo: `Payout to ${acct.bankName} ••••${acct.accountNumberLast4}`,
    postings: payoutPostings(business.id, provider, availableKobo),
  });
  return payout;
}

/** Marks a payout failed and puts its money back in the seller's available balance. */
async function failPayout(tx: Tx, payoutId: string, reason: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
  const p = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (p.status === "failed" || p.status === "paid") return;
  await tx.payout.update({ where: { id: p.id }, data: { status: "failed", failureReason: reason.slice(0, 500) } });
  await postLedgerTransaction(tx, {
    kind: "payout_returned",
    referenceType: "payout",
    referenceId: p.id,
    memo: `Payout ${p.reference} didn't go through: returned to your balance`,
    postings: payoutReturnedPostings(p.businessId, p.provider, p.amountKobo),
  });
}

async function applyTransferResult(payoutId: string, r: TransferResult, now: Date): Promise<PayoutStatus> {
  return withSystemContext(async (tx) => {
    if (r.status === "failed") {
      await failPayout(tx, payoutId, r.message ?? "The bank transfer failed");
      return "failed";
    }
    await tx.payout.update({
      where: { id: payoutId },
      data: { status: r.status === "paid" ? "paid" : "processing", providerTransferCode: r.transferCode, paidAt: r.status === "paid" ? now : null },
    });
    return r.status === "paid" ? "paid" : "processing";
  });
}

/** Sends a pending payout's transfer (or, if it was already sent, reads its outcome). */
export async function sendPayout(payoutId: string, now = new Date()): Promise<PayoutStatus> {
  const p = await withSystemContext(async (tx) => {
    const row = await tx.payout.findUnique({ where: { id: payoutId }, include: { business: { include: { payoutAccount: true } } } });
    if (row?.status === "pending") await tx.payout.update({ where: { id: row.id }, data: { sentAt: now } });
    return row;
  });
  if (!p || p.status !== "pending") return p?.status ?? "failed";
  const provider = transferProvider();
  const recipient = p.business.payoutAccount?.providerRecipientCode;
  if (!recipient) {
    await withSystemContext((tx) => failPayout(tx, p.id, "No verified bank account"));
    return "failed";
  }
  let result: TransferResult;
  try {
    // A pending payout may have been sent before a crash: ask first, send only if the provider never got it.
    result = (await provider.verify(p.reference)) ?? (await provider.send({ reference: p.reference, amountKobo: p.amountKobo, recipientCode: recipient, reason: `TownMart payout ${p.reference}` }));
  } catch (err) {
    logger.error({ err, payout: p.reference }, "payout transfer call failed");
    return "pending";
  }
  return applyTransferResult(p.id, result, now);
}

/** Checks a transfer the provider is still working on. */
export async function syncPayout(payoutId: string, now = new Date()): Promise<PayoutStatus> {
  const p = await withSystemContext((tx) => tx.payout.findUnique({ where: { id: payoutId } }));
  if (!p || p.status !== "processing") return p?.status ?? "failed";
  const r = await transferProvider().verify(p.reference);
  if (!r || r.status === "processing") return "processing";
  return applyTransferResult(p.id, r, now);
}

/** A seller asks for their available balance now (any positive amount). */
export async function requestPayout(businessId: string, userId: string, now = new Date()): Promise<{ payout: Payout; status: PayoutStatus } | PayoutBlock> {
  const created = await withSystemContext((tx) => createPayout(tx, { businessId, requestedBy: userId, minimumKobo: 1n, now }));
  if (typeof created === "string") return created;
  return { payout: created, status: await told(created.id, await sendPayout(created.id, now)) };
}

async function told(payoutId: string, status: PayoutStatus): Promise<PayoutStatus> {
  if (status === "paid" || status === "failed") await enqueueNotice({ type: "payout.update", payoutId, status });
  return status;
}

/**
 * Worker job (daily): pays out every approved seller whose available
 * balance is at least the minimum.
 */
export async function runPayouts(now = new Date()): Promise<{ created: number; paid: number; failed: number }> {
  const minimumKobo = await withSystemContext(async (tx) => (await getCheckoutSettings(tx)).payoutMinimumKobo);
  const candidates = await withSystemContext((tx) =>
    tx.$queryRaw<{ business_id: string }[]>`
      SELECT e.business_id FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.owner_type = 'business' AND a.type = 'available'
       GROUP BY e.business_id HAVING sum(e.credit_kobo - e.debit_kobo) >= ${minimumKobo} AND sum(e.credit_kobo - e.debit_kobo) > 0`,
  );
  const out = { created: 0, paid: 0, failed: 0 };
  for (const c of candidates) {
    try {
      const p = await withSystemContext((tx) => createPayout(tx, { businessId: c.business_id, requestedBy: null, minimumKobo, now }));
      if (typeof p === "string") continue;
      out.created++;
      const s = await told(p.id, await sendPayout(p.id, now));
      if (s === "paid") out.paid++;
      if (s === "failed") out.failed++;
    } catch (err) {
      logger.error({ err, businessId: c.business_id }, "payout failed to start");
    }
  }
  return out;
}

/** Worker job: retries transfers left pending (a crash or outage) and checks on ones still processing. */
export async function syncPayouts(now = new Date()): Promise<{ paid: number; failed: number }> {
  const stuck = await withSystemContext((tx) =>
    tx.payout.findMany({ where: { OR: [{ status: "processing" }, { status: "pending", createdAt: { lt: new Date(now.getTime() - 10 * 60_000) } }] }, select: { id: true, status: true }, take: 200 }),
  );
  const out = { paid: 0, failed: 0 };
  for (const p of stuck) {
    try {
      const s = await told(p.id, p.status === "pending" ? await sendPayout(p.id, now) : await syncPayout(p.id, now));
      if (s === "paid") out.paid++;
      if (s === "failed") out.failed++;
    } catch (err) {
      logger.error({ err, payoutId: p.id }, "payout check failed");
    }
  }
  return out;
}

/** Webhook hint: a transfer changed. */
export async function syncPayoutByReference(reference: string): Promise<void> {
  const p = await withSystemContext((tx) => tx.payout.findUnique({ where: { reference }, select: { id: true, status: true } }));
  if (p?.status === "processing") await told(p.id, await syncPayout(p.id));
  if (p?.status === "pending") await told(p.id, await sendPayout(p.id));
}

export const describePayout = (p: Pick<Payout, "amountKobo" | "bankName" | "accountNumberLast4">) => `${formatPrice(p.amountKobo)} to ${p.bankName} ••••${p.accountNumberLast4}`;
