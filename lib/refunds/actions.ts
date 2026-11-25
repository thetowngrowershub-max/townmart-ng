"use server";

import { revalidatePath } from "next/cache";
import { withRls, withSystemContext } from "@/lib/db";
import { addDisputeMessage, DisputeError, openDispute, withdrawDispute } from "@/lib/disputes/core";
import { logger } from "@/lib/logger";
import { findViewableOrder } from "@/lib/orders/access";
import { enqueueNotice } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { getCheckoutSettings } from "@/lib/settings";
import { evidencePrefix } from "@/lib/storage/uploads";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { cancelOrderSchema, customerDisputeMessageSchema, openDisputeSchema, refundRequestSchema, withdrawDisputeSchema } from "@/lib/validation/refunds";
import { cancelPaidSellerOrder } from "./cancel";
import { createRefundRequest, RefundError, sendRefund } from "./core";
import { PHOTO_REQUIRED } from "./math";
import { loadHelp } from "./view";

/**
 * The customer's side of refunds and disputes. Each action finds the order
 * the visitor may open (signed in as its shopper, or a guest with the order
 * link), then works in the system scope scoped to that order.
 */

const NOT_FOUND = "We couldn't find that order.";

function failure(err: unknown): ActionResult<never> {
  if (err instanceof RefundError || err instanceof DisputeError) return { ok: false, error: err.message };
  logger.error({ err }, "customer refund action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function order(orderNumber: string, token: string | null | undefined) {
  const meta = await requestMeta();
  if (!(await rateLimit(`refund:${meta.ipHash}`, 30, 600)).allowed) throw new RefundError("Too many changes. Please wait a few minutes.");
  const o = await findViewableOrder(orderNumber, token);
  if (!o) throw new RefundError(NOT_FOUND);
  return o;
}

function refresh(orderNumber: string, sellerOrderId: string) {
  revalidatePath(`/orders/${orderNumber}/help/${sellerOrderId}`);
  revalidatePath(`/account/orders/${orderNumber}`);
  revalidatePath(`/checkout/complete/${orderNumber}`);
  revalidatePath("/account/refunds");
}

/** Sends a just-approved refund straight away; the refunds job retries if this fails. */
async function sendNow(refundId: string) {
  try {
    const status = await sendRefund(refundId);
    if (status === "completed") await enqueueNotice({ type: "refund.update", refundId, status });
  } catch (err) {
    logger.error({ err, refundId }, "sending refund failed; the job will retry");
  }
}

/** Cancels a paid order the seller hasn't started on, with a full refund. */
export async function cancelOrderAction(input: { orderNumber: string; token?: string | null; sellerOrderId: string; reason?: string }): Promise<ActionResult> {
  const parsed = cancelOrderSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const o = await order(parsed.data.orderNumber, parsed.data.token);
    const r = await withSystemContext((tx) =>
      cancelPaidSellerOrder(tx, { sellerOrderId: parsed.data.sellerOrderId, orderId: o.id, by: "customer", actorUserId: o.userId, reason: parsed.data.reason || "Cancelled by the customer" }),
    );
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "approved" });
    await sendNow(r.id);
    refresh(parsed.data.orderNumber, parsed.data.sellerOrderId);
    return { ok: true, message: "Cancelled. Your refund is on its way to your original payment method." };
  } catch (err) {
    return failure(err);
  }
}

/** Asks the seller for a refund or return of some items. */
export async function requestRefundAction(input: {
  orderNumber: string;
  token?: string | null;
  sellerOrderId: string;
  reason: string;
  details: string;
  items: { orderItemId: string; qty: number }[];
  evidenceKeys: string[];
}): Promise<ActionResult<{ href: string }>> {
  const parsed = refundRequestSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  try {
    const o = await order(d.orderNumber, d.token);
    // Photos must be this order's own uploads.
    if (d.evidenceKeys.some((k) => !k.startsWith(evidencePrefix(o.id)))) return { ok: false, error: "Please upload the photos again." };
    const r = await withSystemContext(async (tx) => {
      const help = await loadHelp(tx, o.id, d.sellerOrderId);
      if (!help) throw new RefundError(NOT_FOUND);
      if (!help.request.allowed) throw new RefundError(help.request.why);
      for (const i of d.items) {
        const line = help.items.find((x) => x.id === i.orderItemId);
        if (!line) throw new RefundError("That item isn't part of this order.");
        if (!line.windowOpen) throw new RefundError(`The time to report a problem with ${line.title} has passed.`);
        if (i.qty > line.refundable + 1e-9) throw new RefundError(`You can ask about at most ${line.refundable} of ${line.title}.`);
        if (line.perishable && d.evidenceKeys.length === 0) throw new RefundError(`Add a photo: ${line.title} is fresh produce, so we need to see the problem.`);
      }
      if (PHOTO_REQUIRED.has(d.reason) && d.evidenceKeys.length === 0) return { fieldError: "Add at least one photo of the problem" } as const;
      const settings = await getCheckoutSettings(tx);
      return createRefundRequest(tx, {
        sellerOrderId: d.sellerOrderId,
        origin: "customer",
        requestedBy: o.userId,
        reason: d.reason,
        details: d.details,
        evidenceKeys: d.evidenceKeys,
        items: d.items,
        // Nothing arrived: the delivery fee comes back too.
        includeDelivery: d.reason === "not_received",
        respondBy: new Date(Date.now() + settings.refundResponseHours * 3_600_000),
      });
    });
    if ("fieldError" in r) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: { evidenceKeys: [r.fieldError] } };
    await enqueueNotice({ type: "refund.update", refundId: r.id, status: "requested" });
    refresh(d.orderNumber, d.sellerOrderId);
    const token = d.token ?? null;
    return { ok: true, message: "Sent. The seller has been asked to answer; if they don't in time, TownMart will decide.", data: { href: `/orders/${d.orderNumber}/help/${d.sellerOrderId}${token ? `?t=${encodeURIComponent(token)}` : ""}` } };
  } catch (err) {
    return failure(err);
  }
}

/** Asks TownMart to decide: after a declined refund, or about anything else wrong with the order. */
export async function openDisputeAction(input: { orderNumber: string; token?: string | null; sellerOrderId: string; refundId?: string; reason: string }): Promise<ActionResult> {
  const parsed = openDisputeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const o = await order(parsed.data.orderNumber, parsed.data.token);
    const dispute = await withSystemContext((tx) =>
      openDispute(tx, { sellerOrderId: parsed.data.sellerOrderId, orderId: o.id, refundId: parsed.data.refundId ?? null, openedBy: o.userId, party: "customer", reason: parsed.data.reason }),
    );
    await enqueueNotice({ type: "dispute.update", disputeId: dispute.id, event: "opened" });
    refresh(parsed.data.orderNumber, parsed.data.sellerOrderId);
    return { ok: true, message: "Sent to TownMart. We'll look at it and reply here." };
  } catch (err) {
    return failure(err);
  }
}

/** Adds to a dispute's thread. A signed-in customer writes under RLS; a guest through the system scope after the link check. */
export async function customerDisputeMessageAction(input: { orderNumber: string; token?: string | null; disputeId: string; body: string }): Promise<ActionResult> {
  const parsed = customerDisputeMessageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const o = await order(parsed.data.orderNumber, parsed.data.token);
    const d = await withSystemContext((tx) => tx.dispute.findFirst({ where: { id: parsed.data.disputeId, orderId: o.id }, select: { id: true, businessId: true, sellerOrderId: true, status: true } }));
    if (!d) throw new DisputeError("Dispute not found.");
    if (d.status !== "open") throw new DisputeError("This dispute is closed.");
    const m = o.userId
      ? await withRls({ userId: o.userId }, (tx) => tx.disputeMessage.create({ data: { disputeId: d.id, businessId: d.businessId, sender: "customer", senderUserId: o.userId, body: parsed.data.body } }))
      : await withSystemContext((tx) => addDisputeMessage(tx, { disputeId: d.id, party: "customer", senderUserId: null, body: parsed.data.body }));
    await enqueueNotice({ type: "dispute.update", disputeId: d.id, event: "message", messageId: m.id });
    refresh(parsed.data.orderNumber, d.sellerOrderId);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

export async function withdrawDisputeAction(input: { orderNumber: string; token?: string | null; disputeId: string }): Promise<ActionResult> {
  const parsed = withdrawDisputeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const o = await order(parsed.data.orderNumber, parsed.data.token);
    const d = await withSystemContext((tx) => withdrawDispute(tx, { disputeId: parsed.data.disputeId, orderId: o.id, by: o.userId }));
    refresh(parsed.data.orderNumber, d.sellerOrderId);
    return { ok: true, message: "Withdrawn." };
  } catch (err) {
    return failure(err);
  }
}
