import type { Dispute, DisputeOutcome, DisputeParty } from "@prisma/client";
import { withSystemContext, type Tx } from "@/lib/db";
import { enqueueNotice } from "@/lib/queue";
import { approveRefund, refundedSoFar, refundNow, rejectRefund } from "@/lib/refunds/core";
import { paidOnline, RefundError } from "@/lib/refunds/math";

/**
 * Disputes: TownMart decides between a customer and a seller. A customer
 * opens one when a seller declines a refund or about a problem with their
 * order; a refund request the seller doesn't answer in time is escalated
 * automatically. The seller order's escrow is held while it's open. All
 * writes run in the system scope after the caller's checks.
 */
export class DisputeError extends Error {}

async function lockDispute(tx: Tx, id: string): Promise<Dispute> {
  await tx.$queryRaw`SELECT id FROM disputes WHERE id = ${id}::uuid FOR UPDATE`;
  const d = await tx.dispute.findUnique({ where: { id } });
  if (!d) throw new DisputeError("Dispute not found.");
  return d;
}

export async function openDispute(
  tx: Tx,
  p: { sellerOrderId: string; orderId: string; refundId?: string | null; openedBy: string | null; party: Extract<DisputeParty, "customer" | "system">; reason: string },
): Promise<Dispute> {
  const so = await tx.sellerOrder.findFirst({ where: { id: p.sellerOrderId, orderId: p.orderId } });
  if (!so) throw new DisputeError("Order not found.");
  if (so.status === "pending_payment") throw new DisputeError("This order hasn't been paid for.");
  if (await tx.dispute.findFirst({ where: { sellerOrderId: so.id, status: "open" }, select: { id: true } })) {
    throw new DisputeError("There's already an open dispute about this order. Add to it instead.");
  }
  // TownMart's decision is final for that seller order.
  if (await tx.dispute.findFirst({ where: { sellerOrderId: so.id, status: "resolved" }, select: { id: true } })) {
    throw new DisputeError("TownMart has already decided on this order.");
  }
  if (p.refundId) {
    const r = await tx.refund.findFirst({ where: { id: p.refundId, sellerOrderId: so.id } });
    if (!r) throw new DisputeError("Refund not found.");
    if (r.status !== "rejected" && r.status !== "requested") throw new DisputeError("This refund has already been approved.");
    if (await tx.dispute.findUnique({ where: { refundId: r.id }, select: { id: true } })) throw new DisputeError("This refund has already been taken to TownMart.");
  }
  const d = await tx.dispute.create({
    data: { orderId: so.orderId, sellerOrderId: so.id, businessId: so.businessId, refundId: p.refundId ?? null, openedBy: p.openedBy, openedByParty: p.party, reason: p.reason },
  });
  await tx.disputeMessage.create({ data: { disputeId: d.id, businessId: d.businessId, sender: p.party, senderUserId: p.openedBy, body: p.reason } });
  return d;
}

/** Adds to the thread. Sellers and signed-in customers may write under RLS instead; the policy checks the same things. */
export async function addDisputeMessage(tx: Tx, p: { disputeId: string; party: DisputeParty; senderUserId: string | null; body: string }) {
  const d = await tx.dispute.findUnique({ where: { id: p.disputeId } });
  if (!d) throw new DisputeError("Dispute not found.");
  if (d.status !== "open") throw new DisputeError("This dispute is closed.");
  return tx.disputeMessage.create({ data: { disputeId: d.id, businessId: d.businessId, sender: p.party, senderUserId: p.senderUserId, body: p.body } });
}

export const OUTCOME_LABELS: Record<DisputeOutcome, string> = {
  refund_full: "Full refund",
  refund_partial: "Part refund",
  no_refund: "No refund",
  withdrawn: "Withdrawn",
};

/**
 * TownMart's decision. A refund outcome approves the waiting request (or
 * starts a new refund if the seller had declined it); "no refund" declines
 * a waiting request. The decision is posted to the thread for both sides.
 */
export async function resolveDispute(
  tx: Tx,
  p: { disputeId: string; adminId: string; outcome: Exclude<DisputeOutcome, "withdrawn">; amountKobo?: bigint; note: string; restockItemIds?: string[]; now?: Date },
): Promise<{ dispute: Dispute; refundId: string | null }> {
  const now = p.now ?? new Date();
  const d = await lockDispute(tx, p.disputeId);
  if (d.status !== "open") throw new DisputeError("This dispute is already closed.");
  const so = await tx.sellerOrder.findUniqueOrThrow({ where: { id: d.sellerOrderId } });
  const refund = d.refundId ? await tx.refund.findUnique({ where: { id: d.refundId } }) : null;
  let refundId: string | null = null;

  if (p.outcome === "no_refund") {
    if (refund?.status === "requested") await rejectRefund(tx, { refundId: refund.id, decidedBy: p.adminId, response: `TownMart: ${p.note}`, now });
  } else {
    if (so.payOnDelivery) throw new DisputeError("This order was paid on delivery, so TownMart can't refund it. Record the decision as no refund and ask the seller to repay the customer.");
    const left = paidOnline(so) - (await refundedSoFar(tx, so.id)).amountKobo;
    const amount = p.outcome === "refund_full" ? left : p.amountKobo;
    if (amount === undefined || amount <= 0n) throw new DisputeError("Enter the amount to refund.");
    if (amount > left) throw new RefundError("That's more than is left to refund on this order.");
    if (refund?.status === "requested") {
      refundId = (await approveRefund(tx, { refundId: refund.id, decidedBy: p.adminId, amountKobo: amount, restockItemIds: p.restockItemIds, response: `TownMart: ${p.note}`, now })).id;
    } else {
      const r = await refundNow(tx, {
        sellerOrderId: so.id,
        origin: "admin",
        requestedBy: p.adminId,
        reason: refund && refund.reason !== "payment_problem" ? refund.reason : "other",
        details: `Dispute decision: ${p.note}`,
        includeDelivery: p.outcome === "refund_full",
        amountKobo: amount,
        restockItemIds: p.restockItemIds,
        response: `TownMart: ${p.note}`,
      });
      refundId = r.id;
    }
  }
  const dispute = await tx.dispute.update({ where: { id: d.id }, data: { status: "resolved", outcome: p.outcome, resolutionNote: p.note, resolvedBy: p.adminId, resolvedAt: now } });
  await tx.disputeMessage.create({ data: { disputeId: d.id, businessId: d.businessId, sender: "admin", senderUserId: p.adminId, body: `Decision: ${OUTCOME_LABELS[p.outcome]}. ${p.note}` } });
  return { dispute, refundId };
}

/** The customer withdraws their dispute. */
export async function withdrawDispute(tx: Tx, p: { disputeId: string; orderId: string; by: string | null; now?: Date }): Promise<Dispute> {
  const d = await lockDispute(tx, p.disputeId);
  if (d.orderId !== p.orderId) throw new DisputeError("Dispute not found.");
  if (d.status !== "open") throw new DisputeError("This dispute is already closed.");
  await tx.disputeMessage.create({ data: { disputeId: d.id, businessId: d.businessId, sender: "customer", senderUserId: p.by, body: "Withdrawn by the customer." } });
  return tx.dispute.update({ where: { id: d.id }, data: { status: "closed", outcome: "withdrawn", resolvedAt: p.now ?? new Date() } });
}

/**
 * Worker job: refund requests the seller hasn't answered in time go to
 * TownMart as disputes. The request stays open for TownMart to decide.
 */
export async function escalateOverdueRefunds(now = new Date()): Promise<{ escalated: string[] }> {
  const due = await withSystemContext((tx) =>
    tx.refund.findMany({ where: { status: "requested", origin: "customer", respondBy: { lt: now }, dispute: null }, select: { id: true, sellerOrderId: true, orderId: true }, take: 200 }),
  );
  const escalated: string[] = [];
  for (const r of due) {
    if (!r.sellerOrderId) continue;
    const id = await withSystemContext(async (tx) => {
      if (await tx.dispute.findFirst({ where: { sellerOrderId: r.sellerOrderId!, status: "open" }, select: { id: true } })) return null;
      const d = await openDispute(tx, { sellerOrderId: r.sellerOrderId!, orderId: r.orderId, refundId: r.id, openedBy: null, party: "system", reason: "The seller didn't answer this refund request in time, so TownMart will decide." });
      return d.id;
    });
    if (id) {
      escalated.push(id);
      await enqueueNotice({ type: "dispute.update", disputeId: id, event: "opened" });
    }
  }
  return { escalated };
}
