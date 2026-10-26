"use server";

import { revalidatePath } from "next/cache";
import { assertCan, AuthzError } from "@/lib/authz";
import { withSystemContext } from "@/lib/db";
import { DisputeError } from "@/lib/disputes/core";
import { logger } from "@/lib/logger";
import { parseNairaToKobo } from "@/lib/money";
import { PAYOUT_BLOCK_TEXT, requestPayout } from "@/lib/payouts/payouts";
import { enqueueNotice } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { approveRefundSchema, disputeMessageSchema, rejectRefundSchema } from "@/lib/validation/refunds";
import { approveRefund, RefundError, rejectRefund, sendRefund } from "./core";

/**
 * The seller's side: answering refund requests, writing on disputes and
 * asking for a payout. Refund decisions move money and stock, so they run in
 * the system scope after the permission check, scoped to the seller's
 * business id; dispute messages are written under the seller's RLS.
 */

async function seller(permission: "order.manage" | "payout.manage"): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, permission, { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof RefundError || err instanceof DisputeError) return { ok: false, error: err.message };
  logger.error({ err }, "seller refund action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refresh(refundId?: string) {
  revalidatePath("/dashboard/refunds");
  if (refundId) revalidatePath(`/dashboard/refunds/${refundId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/payouts");
}

export async function approveRefundAction(input: { refundId: string; amount?: string; restock?: string[]; note?: string }): Promise<ActionResult> {
  const parsed = approveRefundSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    const r = await withSystemContext((tx) =>
      approveRefund(tx, {
        refundId: parsed.data.refundId,
        businessId: ctx.business.id,
        decidedBy: ctx.user.id,
        amountKobo: parsed.data.amount ? parseNairaToKobo(parsed.data.amount) : undefined,
        restockItemIds: parsed.data.restock,
        response: parsed.data.note || null,
      }),
    );
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "approved" });
    try {
      if ((await sendRefund(r.id)) === "completed") await enqueueNotice({ type: "refund.update", refundId: r.id, status: "completed" });
    } catch (err) {
      logger.error({ err, refundId: r.id }, "sending refund failed; the job will retry");
    }
    refresh(r.id);
    if (r.sellerOrderId) revalidatePath(`/dashboard/orders/${r.sellerOrderId}`);
    return { ok: true, message: "Approved. The customer is being refunded." };
  } catch (err) {
    return failure(err);
  }
}

export async function rejectRefundAction(input: { refundId: string; response: string }): Promise<ActionResult> {
  const parsed = rejectRefundSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    const r = await withSystemContext((tx) => rejectRefund(tx, { refundId: parsed.data.refundId, businessId: ctx.business.id, decidedBy: ctx.user.id, response: parsed.data.response }));
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "rejected" });
    refresh(r.id);
    return { ok: true, message: "Declined. The customer has been told and can ask TownMart to decide." };
  } catch (err) {
    return failure(err);
  }
}

export async function sellerDisputeMessageAction(input: { disputeId: string; body: string }): Promise<ActionResult> {
  const parsed = disputeMessageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    // The RLS policy checks the dispute is this business's and still open.
    const m = await withSellerRls(ctx, async (tx) => {
      const d = await tx.dispute.findFirst({ where: { id: parsed.data.disputeId, businessId: ctx.business.id }, select: { id: true, status: true } });
      if (!d) throw new DisputeError("Dispute not found.");
      if (d.status !== "open") throw new DisputeError("This dispute is closed.");
      return tx.disputeMessage.create({ data: { disputeId: d.id, businessId: ctx.business.id, sender: "seller", senderUserId: ctx.user.id, body: parsed.data.body } });
    });
    await enqueueNotice({ type: "dispute.update", disputeId: parsed.data.disputeId, event: "message", messageId: m.id });
    revalidatePath(`/dashboard/disputes/${parsed.data.disputeId}`);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Pays the available balance out now. Owner only. */
export async function requestPayoutAction(): Promise<ActionResult> {
  try {
    const ctx = await seller("payout.manage");
    if (!(await rateLimit(`payout:${ctx.business.id}`, 5, 3600)).allowed) return { ok: false, error: "You've asked a few times already. Please wait a while." };
    const res = await requestPayout(ctx.business.id, ctx.user.id);
    refresh();
    if (typeof res === "string") return { ok: false, error: PAYOUT_BLOCK_TEXT[res] };
    if (res.status === "failed") return { ok: false, error: "The bank transfer didn't go through, so the money is back in your balance. Check your bank details in Store settings." };
    return { ok: true, message: res.status === "paid" ? "Sent to your bank." : "On its way to your bank." };
  } catch (err) {
    return failure(err);
  }
}
