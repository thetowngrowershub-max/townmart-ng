"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { assertCan, AuthzError, type GlobalPermission } from "@/lib/authz";
import { withRls, type Tx } from "@/lib/db";
import { addDisputeMessage, DisputeError, resolveDispute } from "@/lib/disputes/core";
import { logger } from "@/lib/logger";
import { parseNairaToKobo } from "@/lib/money";
import { releaseDueEscrow } from "@/lib/payouts/escrow";
import { runPayouts } from "@/lib/payouts/payouts";
import { enqueueNotice } from "@/lib/queue";
import { approveRefund, RefundError, refundNow, rejectRefund, sendRefund } from "@/lib/refunds/core";
import { requestMeta } from "@/lib/request";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { adminRefundSchema, approveRefundSchema, disputeMessageSchema, refundIdSchema, rejectRefundSchema, resolveDisputeSchema } from "@/lib/validation/refunds";

/**
 * TownMart's side: refunds it starts or overrides, dispute decisions and the
 * money jobs on demand. Admin scope (privileged under RLS); every decision is
 * written to the audit log.
 */

async function admin(permission: GlobalPermission) {
  const actor = await getCurrentUser();
  assertCan(actor, permission);
  const meta = await requestMeta();
  const role = actor.roles.includes("super_admin") ? "super_admin" : "admin";
  const run = <T,>(fn: (tx: Tx, audit: (action: string, entityType: string, entityId: string | null, after: unknown) => Promise<void>) => Promise<T>) =>
    withRls({ scope: "admin", userId: actor.id }, (tx) =>
      fn(tx, (action, entityType, entityId, after) => writeAudit(tx, { actorUserId: actor.id, actorRole: role, action, entityType, entityId, after, ipHash: meta.ipHash })),
    );
  return { actor, run };
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof RefundError || err instanceof DisputeError) return { ok: false, error: err.message };
  logger.error({ err }, "admin finance action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function sendNow(refundId: string) {
  try {
    if ((await sendRefund(refundId)) === "completed") await enqueueNotice({ type: "refund.update", refundId, status: "completed" });
  } catch (err) {
    logger.error({ err, refundId }, "sending refund failed; the job will retry");
  }
}

function refresh() {
  revalidatePath("/admin/orders", "layout");
  revalidatePath("/admin/payouts");
}

/** A refund TownMart starts on a seller order (an override of the seller, or after a phone complaint). */
export async function adminRefundAction(input: { sellerOrderId: string; amount: string; reason: string; note: string; restock?: string[] }): Promise<ActionResult> {
  const parsed = adminRefundSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  try {
    const { actor, run } = await admin("finance.manage");
    const r = await run(async (tx, audit) => {
      const r = await refundNow(tx, {
        sellerOrderId: d.sellerOrderId,
        origin: "admin",
        requestedBy: actor.id,
        reason: d.reason,
        details: d.note,
        includeDelivery: d.amount === "",
        amountKobo: d.amount ? parseNairaToKobo(d.amount) : undefined,
        restockItemIds: d.restock,
        response: `TownMart: ${d.note}`,
      });
      await audit("refund.created", "refund", r.id, { refundNumber: r.refundNumber, amountKobo: r.amountKobo.toString(), reason: d.reason, note: d.note });
      return r;
    });
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "approved" });
    await sendNow(r.id);
    refresh();
    return { ok: true, message: `Refund ${r.refundNumber} approved and sent.` };
  } catch (err) {
    return failure(err);
  }
}

/** Approves a waiting request on the seller's behalf. */
export async function adminApproveRefundAction(input: { refundId: string; amount?: string; restock?: string[]; note?: string }): Promise<ActionResult> {
  const parsed = approveRefundSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await admin("finance.manage");
    const r = await run(async (tx, audit) => {
      const r = await approveRefund(tx, {
        refundId: parsed.data.refundId,
        decidedBy: actor.id,
        amountKobo: parsed.data.amount ? parseNairaToKobo(parsed.data.amount) : undefined,
        restockItemIds: parsed.data.restock,
        response: parsed.data.note ? `TownMart: ${parsed.data.note}` : "Approved by TownMart",
      });
      await audit("refund.approved", "refund", r.id, { amountKobo: r.amountKobo.toString(), note: parsed.data.note });
      return r;
    });
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "approved" });
    await sendNow(r.id);
    refresh();
    return { ok: true, message: "Approved and sent." };
  } catch (err) {
    return failure(err);
  }
}

export async function adminRejectRefundAction(input: { refundId: string; response: string }): Promise<ActionResult> {
  const parsed = rejectRefundSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await admin("finance.manage");
    const r = await run(async (tx, audit) => {
      const r = await rejectRefund(tx, { refundId: parsed.data.refundId, decidedBy: actor.id, response: `TownMart: ${parsed.data.response}` });
      await audit("refund.rejected", "refund", r.id, { response: parsed.data.response });
      return r;
    });
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "rejected" });
    refresh();
    return { ok: true, message: "Declined." };
  } catch (err) {
    return failure(err);
  }
}

/** Sends a failed refund to the provider again (after checking the provider dashboard). */
export async function retryRefundAction(input: { refundId: string }): Promise<ActionResult> {
  const parsed = refundIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { run } = await admin("finance.manage");
    await run(async (tx, audit) => {
      const r = await tx.refund.findUnique({ where: { id: parsed.data.refundId } });
      if (!r || r.status !== "failed") throw new RefundError("Only a failed refund can be retried.");
      await audit("refund.retried", "refund", r.id, { lastError: r.lastError });
    });
    const status = await sendRefund(parsed.data.refundId);
    if (status === "completed") await enqueueNotice({ type: "refund.update", refundId: parsed.data.refundId, status });
    refresh();
    return status === "failed" ? { ok: false, error: "The provider declined it again. See the error on the refund." } : { ok: true, message: status === "completed" ? "Refunded." : "Sent; the provider is processing it." };
  } catch (err) {
    return failure(err);
  }
}

export async function resolveDisputeAction(input: { disputeId: string; outcome: string; amount: string; note: string }): Promise<ActionResult> {
  const parsed = resolveDisputeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  if (d.outcome === "refund_partial" && !d.amount) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { amount: ["Enter the amount to refund"] } };
  try {
    const { actor, run } = await admin("dispute.manage");
    const res = await run(async (tx, audit) => {
      const res = await resolveDispute(tx, { disputeId: d.disputeId, adminId: actor.id, outcome: d.outcome, amountKobo: d.amount ? parseNairaToKobo(d.amount) : undefined, note: d.note });
      await audit("dispute.resolved", "dispute", d.disputeId, { outcome: d.outcome, amount: d.amount, note: d.note, refundId: res.refundId });
      return res;
    });
    await enqueueNotice({ type: "dispute.update", disputeId: d.disputeId, event: "resolved" });
    if (res.refundId) {
      await enqueueNotice({ type: "refund.update", refundId: res.refundId, status: "approved" });
      await sendNow(res.refundId);
    }
    refresh();
    return { ok: true, message: "Decision recorded and sent to both sides." };
  } catch (err) {
    return failure(err);
  }
}

export async function adminDisputeMessageAction(input: { disputeId: string; body: string }): Promise<ActionResult> {
  const parsed = disputeMessageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { actor, run } = await admin("dispute.manage");
    const m = await run((tx) => addDisputeMessage(tx, { disputeId: parsed.data.disputeId, party: "admin", senderUserId: actor.id, body: parsed.data.body }));
    await enqueueNotice({ type: "dispute.update", disputeId: parsed.data.disputeId, event: "message", messageId: m.id });
    refresh();
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Runs the escrow release and payout jobs now instead of waiting for the schedule. */
export async function runMoneyJobsAction(input: { job: "escrow" | "payouts" }): Promise<ActionResult> {
  try {
    const { run } = await admin("finance.manage");
    await run((_tx, audit) => audit(`jobs.${input.job === "escrow" ? "escrow_release" : "payouts"}.run`, "job", null, null));
    if (input.job === "escrow") {
      const r = await releaseDueEscrow();
      refresh();
      return { ok: true, message: `Released ${r.released} order${r.released === 1 ? "" : "s"}; settled ${r.settled} pay-on-delivery order${r.settled === 1 ? "" : "s"}.` };
    }
    const r = await runPayouts();
    refresh();
    return { ok: true, message: `Started ${r.created} payout${r.created === 1 ? "" : "s"}: ${r.paid} paid, ${r.failed} failed.` };
  } catch (err) {
    return failure(err);
  }
}
