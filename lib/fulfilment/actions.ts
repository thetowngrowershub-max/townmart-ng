"use server";

import { revalidatePath } from "next/cache";
import { assertCan, AuthzError } from "@/lib/authz";
import { withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueNotice } from "@/lib/queue";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { getCheckoutSettings } from "@/lib/settings";
import { advanceOrderSchema, cancelReasonSchema, messageSchema, sellerOrderIdSchema } from "@/lib/validation/fulfilment";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { advanceSellerOrder, cancelSellerOrder, FulfilmentError, markCashCollected } from "./orders";

async function seller(permission: "order.read" | "order.manage"): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, permission, { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof FulfilmentError) return { ok: false, error: err.message };
  // The status trigger refusing a step the page offered: someone else moved the order first.
  if (err instanceof Error && /can't move/.test(err.message)) return { ok: false, error: "This order has already moved on. Refresh the page to see its status." };
  logger.error({ err }, "order action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

const refresh = (id: string) => {
  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${id}`);
};

/** Moves an order a step forward (preparing, sent, ready for pickup, delivered). */
export async function advanceOrderAction(input: { id: string; to: string; trackingNumber?: string; carrier?: string }): Promise<ActionResult> {
  const parsed = advanceOrderSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { id, to, trackingNumber, carrier } = parsed.data;
  try {
    const ctx = await seller("order.manage");
    await withSellerRls(ctx, async (tx) => {
      const settings = await getCheckoutSettings(tx);
      await advanceSellerOrder(tx, {
        sellerOrderId: id,
        businessId: ctx.business.id,
        to,
        actorUserId: ctx.user.id,
        tracking: trackingNumber ? { number: trackingNumber, carrier: carrier || null } : null,
        escrowReleaseDays: settings.escrowReleaseDays,
      });
    });
    await enqueueNotice({ type: "order.status", sellerOrderId: id, status: to });
    refresh(id);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Pay on delivery: the seller has the cash (or transfer). */
export async function markCashCollectedAction(input: { id: string }): Promise<ActionResult> {
  const parsed = sellerOrderIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    await withSellerRls(ctx, (tx) => markCashCollected(tx, { sellerOrderId: parsed.data.id, businessId: ctx.business.id }));
    refresh(parsed.data.id);
    return { ok: true, message: "Marked as paid." };
  } catch (err) {
    return failure(err);
  }
}

/**
 * Cancels the seller's part of a pay-on-delivery order before handover. It
 * puts stock back across sellers' shared tables, so it runs in the system
 * scope after the permission check, scoped to the seller's business id.
 */
export async function cancelSellerOrderAction(input: { id: string; reason: string }): Promise<ActionResult> {
  const parsed = cancelReasonSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    await withSystemContext((tx) => cancelSellerOrder(tx, { sellerOrderId: parsed.data.id, businessId: ctx.business.id, actorUserId: ctx.user.id, reason: parsed.data.reason, by: "seller" }));
    await enqueueNotice({ type: "order.status", sellerOrderId: parsed.data.id, status: "cancelled" });
    refresh(parsed.data.id);
    return { ok: true, message: "Order cancelled." };
  } catch (err) {
    return failure(err);
  }
}

/** The seller writes to the customer about an order. */
export async function sendSellerMessageAction(input: { sellerOrderId: string; body: string }): Promise<ActionResult> {
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    const m = await withSellerRls(ctx, async (tx) => {
      const so = await tx.sellerOrder.findFirst({ where: { id: parsed.data.sellerOrderId, businessId: ctx.business.id, status: { not: "pending_payment" } }, select: { id: true } });
      if (!so) throw new FulfilmentError("Order not found.");
      return tx.message.create({ data: { sellerOrderId: so.id, businessId: ctx.business.id, senderUserId: ctx.user.id, sender: "seller", body: parsed.data.body } });
    });
    await enqueueNotice({ type: "message.new", messageId: m.id });
    refresh(parsed.data.sellerOrderId);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
