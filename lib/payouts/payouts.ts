import type { Payout, PayoutAccount, PayoutStatus } from "@prisma/client";
import { withSystemContext, type Tx } from "@/lib/db";
import { payoutPostings, payoutReturnedPostings, type Payee } from "@/lib/ledger/entries";
import { postLedgerTransaction } from "@/lib/ledger/post";
import { logger } from "@/lib/logger";
import { formatPrice } from "@/lib/money";
import { recipientUsable, transferProvider, type TransferResult } from "@/lib/payments/transfers";
import { enqueueNotice } from "@/lib/queue";
import { getCheckoutSettings } from "@/lib/settings";
import { riderBalance } from "@/lib/wallets/rider";
import { businessBalances } from "./balances";

/**
 * Payouts: a seller's (or TownMart pool rider's) whole available balance goes
 * to their verified bank account by transfer. The ledger is written when the
 * payout is created, so the balance can't be paid twice; a failed transfer or
 * a rejected request is reversed back into the available balance.
 *
 * With "payouts.require_approval" on (the default), a payout waits for an
 * admin to approve it before any money moves. The provider call happens
 * outside any database transaction, keyed by our payout reference so a retry
 * can't pay twice.
 */
export class PayoutError extends Error {}

export type PayoutBlock = "not_approved" | "no_bank" | "in_flight" | "too_small";

export const PAYOUT_BLOCK_TEXT: Record<PayoutBlock, string> = {
  not_approved: "Payouts start once your store is approved.",
  no_bank: "Add and verify your bank account in Store settings to get paid.",
  in_flight: "A payout is already on its way.",
  too_small: "There's nothing to pay out yet.",
};

export const RIDER_PAYOUT_BLOCK_TEXT: Record<PayoutBlock, string> = {
  not_approved: "Payouts start once TownMart has approved you as a rider.",
  no_bank: "Add your bank account below to get paid.",
  in_flight: "A payout is already waiting or on its way.",
  too_small: "There's nothing to pay out yet.",
};

const IN_FLIGHT: PayoutStatus[] = ["awaiting_approval", "pending", "processing"];

const payeeOf = (p: Pick<Payout, "businessId" | "riderId">): Payee => (p.businessId ? { kind: "business", id: p.businessId } : { kind: "rider", id: p.riderId! });
const ownerWhere = (payee: Payee) => (payee.kind === "business" ? { businessId: payee.id } : { riderId: payee.id });

type PayeeState = { allowed: boolean; createdAt: Date; account: PayoutAccount | null; availableKobo: bigint };

async function payeeState(tx: Tx, payee: Payee): Promise<PayeeState> {
  if (payee.kind === "business") {
    const b = await tx.business.findUniqueOrThrow({ where: { id: payee.id }, include: { payoutAccount: true } });
    return { allowed: b.status === "approved", createdAt: b.createdAt, account: b.payoutAccount, availableKobo: (await businessBalances(tx, b.id)).availableKobo };
  }
  const r = await tx.rider.findUniqueOrThrow({ where: { id: payee.id }, include: { payoutAccount: true } });
  // Pool riders only (shop riders are paid by their shop), and only while active.
  return { allowed: r.businessId === null && r.isActive, createdAt: r.createdAt, account: r.payoutAccount, availableKobo: await riderBalance(tx, r.id) };
}

/** Our payout reference: unique, and the provider's idempotency key. */
const reference = (payee: Payee, now: Date) => `PO${payee.kind === "rider" ? "R" : ""}-${now.getTime().toString(36).toUpperCase()}-${payee.id.slice(-6).toUpperCase()}`;

/**
 * Creates a payout of the payee's available balance, if it can be paid:
 * approved store (or active pool rider), verified bank account registered
 * with the payout provider, nothing already waiting or on its way, and at
 * least `minimumKobo`. It waits for approval when `requireApproval` is set.
 */
export async function createPayout(
  tx: Tx,
  p: { payee?: Payee; businessId?: string; requestedBy: string | null; minimumKobo: bigint; requireApproval?: boolean; now?: Date },
): Promise<Payout | PayoutBlock> {
  const now = p.now ?? new Date();
  const payee: Payee = p.payee ?? { kind: "business", id: p.businessId! };
  // One payout run per payee at a time.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`payout:${payee.id}`}))`;
  const st = await payeeState(tx, payee);
  if (!st.allowed) return "not_approved";
  const acct = st.account;
  if (!acct || !recipientUsable(acct)) return "no_bank";
  if (await tx.payout.findFirst({ where: { ...ownerWhere(payee), status: { in: IN_FLIGHT } }, select: { id: true } })) return "in_flight";
  if (st.availableKobo <= 0n || st.availableKobo < p.minimumKobo) return "too_small";

  const last = await tx.payout.findFirst({ where: { ...ownerWhere(payee), status: { in: ["paid", "processing"] } }, orderBy: { periodEnd: "desc" }, select: { periodEnd: true } });
  const provider = transferProvider().name;
  const payout = await tx.payout.create({
    data: {
      ...ownerWhere(payee),
      amountKobo: st.availableKobo,
      status: p.requireApproval ? "awaiting_approval" : "pending",
      provider,
      reference: reference(payee, now),
      bankName: acct.bankName,
      accountNumberLast4: acct.accountNumberLast4,
      accountName: acct.accountName,
      periodStart: last?.periodEnd ?? st.createdAt,
      periodEnd: now,
      requestedBy: p.requestedBy,
    },
  });
  await postLedgerTransaction(tx, {
    kind: "payout",
    referenceType: "payout",
    referenceId: payout.id,
    memo: `Payout to ${acct.bankName} ••••${acct.accountNumberLast4}`,
    postings: payoutPostings(payee, provider, st.availableKobo),
  });
  return payout;
}

/** Marks a payout failed (or rejected) and puts its money back in the available balance. */
async function returnPayout(tx: Tx, payoutId: string, status: "failed" | "rejected", reason: string, reviewer?: { userId: string; at: Date }): Promise<boolean> {
  await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
  const p = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (p.status === "failed" || p.status === "paid" || p.status === "rejected") return false;
  if (status === "rejected" && p.status !== "awaiting_approval") return false;
  await tx.payout.update({
    where: { id: p.id },
    data: { status, failureReason: reason.slice(0, 500), ...(reviewer ? { reviewedBy: reviewer.userId, reviewedAt: reviewer.at } : {}) },
  });
  await postLedgerTransaction(tx, {
    kind: "payout_returned",
    referenceType: "payout",
    referenceId: p.id,
    memo: status === "rejected" ? `Payout ${p.reference} not approved: returned to your balance` : `Payout ${p.reference} didn't go through: returned to your balance`,
    postings: payoutReturnedPostings(payeeOf(p), p.provider, p.amountKobo),
  });
  return true;
}

async function applyTransferResult(payoutId: string, r: TransferResult, now: Date): Promise<PayoutStatus> {
  return withSystemContext(async (tx) => {
    if (r.status === "failed") {
      await returnPayout(tx, payoutId, "failed", r.message ?? "The bank transfer failed");
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
    const row = await tx.payout.findUnique({ where: { id: payoutId }, include: { business: { include: { payoutAccount: true } }, rider: { include: { payoutAccount: true } } } });
    if (row?.status === "pending") await tx.payout.update({ where: { id: row.id }, data: { sentAt: now } });
    return row;
  });
  if (!p || p.status !== "pending") return p?.status ?? "failed";
  const provider = transferProvider();
  const acct = p.business?.payoutAccount ?? p.rider?.payoutAccount ?? null;
  if (!acct || !recipientUsable(acct)) {
    await withSystemContext((tx) => returnPayout(tx, p.id, "failed", "No verified bank account for this payout provider"));
    return "failed";
  }
  if (provider.name !== p.provider) {
    // The payout provider changed after this payout was written: its money left the old provider's clearing account.
    await withSystemContext((tx) => returnPayout(tx, p.id, "failed", `Payout provider changed from ${p.provider} to ${provider.name}; ask again`));
    return "failed";
  }
  let result: TransferResult;
  try {
    // A pending payout may have been sent before a crash: ask first, send only if the provider never got it.
    result = (await provider.verify(p.reference)) ?? (await provider.send({ reference: p.reference, amountKobo: p.amountKobo, recipientCode: acct.providerRecipientCode!, reason: `TownMart payout ${p.reference}` }));
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

async function requireApproval(): Promise<boolean> {
  return withSystemContext(async (tx) => (await getCheckoutSettings(tx)).payoutRequireApproval);
}

/** Sends the payout unless it's waiting for approval; tells the payee about the outcome. */
async function startPayout(created: Payout, now: Date): Promise<PayoutStatus> {
  if (created.status === "awaiting_approval") {
    await enqueueNotice({ type: "payout.update", payoutId: created.id, status: created.status });
    return created.status;
  }
  return told(created.id, await sendPayout(created.id, now));
}

/** A seller asks for their available balance now (any positive amount). */
export async function requestPayout(businessId: string, userId: string, now = new Date()): Promise<{ payout: Payout; status: PayoutStatus } | PayoutBlock> {
  return requestPayoutFor({ kind: "business", id: businessId }, userId, now);
}

/** A seller or pool rider asks for their available balance now (any positive amount). */
export async function requestPayoutFor(payee: Payee, userId: string, now = new Date()): Promise<{ payout: Payout; status: PayoutStatus } | PayoutBlock> {
  const approval = await requireApproval();
  const created = await withSystemContext((tx) => createPayout(tx, { payee, requestedBy: userId, minimumKobo: 1n, requireApproval: approval, now }));
  if (typeof created === "string") return created;
  return { payout: created, status: await startPayout(created, now) };
}

/** An admin approves a payout that's waiting: it's sent at once. */
export async function approvePayout(payoutId: string, adminUserId: string, now = new Date()): Promise<PayoutStatus | "not_waiting"> {
  const ok = await withSystemContext(async (tx) => {
    await tx.$queryRaw`SELECT id FROM payouts WHERE id = ${payoutId}::uuid FOR UPDATE`;
    const p = await tx.payout.findUnique({ where: { id: payoutId } });
    if (p?.status !== "awaiting_approval") return false;
    await tx.payout.update({ where: { id: p.id }, data: { status: "pending", reviewedBy: adminUserId, reviewedAt: now } });
    return true;
  });
  if (!ok) return "not_waiting";
  return told(payoutId, await sendPayout(payoutId, now));
}

/** An admin turns down a payout that's waiting: the money goes back to the balance. */
export async function rejectPayout(payoutId: string, adminUserId: string, reason: string, now = new Date()): Promise<boolean> {
  const done = await withSystemContext((tx) => returnPayout(tx, payoutId, "rejected", reason || "Not approved by TownMart", { userId: adminUserId, at: now }));
  if (done) await enqueueNotice({ type: "payout.update", payoutId, status: "rejected" });
  return done;
}

async function told(payoutId: string, status: PayoutStatus): Promise<PayoutStatus> {
  if (status === "paid" || status === "failed") await enqueueNotice({ type: "payout.update", payoutId, status });
  return status;
}

/**
 * Worker job (daily): pays out every approved seller and pool rider whose
 * available balance is at least the minimum (or queues it for approval).
 */
export async function runPayouts(now = new Date()): Promise<{ created: number; paid: number; failed: number; awaiting: number }> {
  const { minimumKobo, approval } = await withSystemContext(async (tx) => {
    const s = await getCheckoutSettings(tx);
    return { minimumKobo: s.payoutMinimumKobo, approval: s.payoutRequireApproval };
  });
  const candidates = await withSystemContext((tx) =>
    tx.$queryRaw<{ kind: "business" | "rider"; id: string }[]>`
      SELECT a.owner_type::text AS kind, a.owner_key AS id
        FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
       WHERE a.owner_type IN ('business', 'rider') AND a.type = 'available'
       GROUP BY a.owner_type, a.owner_key
      HAVING sum(e.credit_kobo - e.debit_kobo) >= ${minimumKobo} AND sum(e.credit_kobo - e.debit_kobo) > 0`,
  );
  const out = { created: 0, paid: 0, failed: 0, awaiting: 0 };
  for (const c of candidates) {
    try {
      const p = await withSystemContext((tx) => createPayout(tx, { payee: { kind: c.kind, id: c.id }, requestedBy: null, minimumKobo, requireApproval: approval, now }));
      if (typeof p === "string") continue;
      out.created++;
      const s = await startPayout(p, now);
      if (s === "paid") out.paid++;
      if (s === "failed") out.failed++;
      if (s === "awaiting_approval") out.awaiting++;
    } catch (err) {
      logger.error({ err, payee: c }, "payout failed to start");
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
