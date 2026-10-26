"use server";

import { revalidatePath } from "next/cache";
import { withRls, withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { findViewableOrder } from "@/lib/orders/access";
import { enqueueNotice } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { confirmReceivedSchema, customerMessageSchema } from "@/lib/validation/fulfilment";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { completeSellerOrder, FulfilmentError } from "./orders";

const NOT_FOUND = "We couldn't find that order.";

function failure(err: unknown): ActionResult<never> {
  if (err instanceof FulfilmentError) return { ok: false, error: err.message };
  logger.error({ err }, "customer order action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refresh(orderNumber: string) {
  revalidatePath(`/account/orders/${orderNumber}`);
  revalidatePath(`/checkout/complete/${orderNumber}`);
}

/** The customer says a delivered order arrived: it's completed (and the seller's escrow can be released in Phase 5). */
export async function confirmReceivedAction(input: { orderNumber: string; token?: string | null; sellerOrderId: string }): Promise<ActionResult> {
  const parsed = confirmReceivedSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const order = await findViewableOrder(parsed.data.orderNumber, parsed.data.token);
    if (!order) return { ok: false, error: NOT_FOUND };
    const done = await withSystemContext(async (tx) => {
      const so = await tx.sellerOrder.findFirst({ where: { id: parsed.data.sellerOrderId, orderId: order.id }, select: { id: true } });
      if (!so) throw new FulfilmentError(NOT_FOUND);
      return completeSellerOrder(tx, { sellerOrderId: so.id, actorUserId: order.userId, note: "Customer confirmed it arrived" });
    });
    if (!done) return { ok: false, error: "This order isn't marked as delivered yet." };
    refresh(parsed.data.orderNumber);
    return { ok: true, message: "Thanks for confirming." };
  } catch (err) {
    return failure(err);
  }
}

/**
 * The customer writes to a seller about their part of the order. Signed-in
 * customers write under RLS (the policy checks the order is theirs); guests
 * are checked by their order link and written in the system scope.
 */
export async function sendCustomerMessageAction(input: { orderNumber: string; token?: string | null; sellerOrderId: string; body: string }): Promise<ActionResult> {
  const parsed = customerMessageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const meta = await requestMeta();
  if (!(await rateLimit(`message:${meta.ipHash}`, 20, 600)).allowed) return { ok: false, error: "You're sending messages too fast. Please wait a few minutes." };
  try {
    const order = await findViewableOrder(parsed.data.orderNumber, parsed.data.token);
    if (!order) return { ok: false, error: NOT_FOUND };
    const write = async (tx: Parameters<Parameters<typeof withSystemContext>[0]>[0]) => {
      const so = await tx.sellerOrder.findFirst({ where: { id: parsed.data.sellerOrderId, orderId: order.id, status: { not: "pending_payment" } }, select: { id: true, businessId: true } });
      if (!so) throw new FulfilmentError(NOT_FOUND);
      return tx.message.create({ data: { sellerOrderId: so.id, businessId: so.businessId, senderUserId: order.userId, sender: "customer", body: parsed.data.body } });
    };
    // A guest order has no user; a signed-in owner writes as themselves.
    const m = order.userId ? await withRls({ userId: order.userId }, write) : await withSystemContext(write);
    await enqueueNotice({ type: "message.new", messageId: m.id });
    refresh(parsed.data.orderNumber);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}
