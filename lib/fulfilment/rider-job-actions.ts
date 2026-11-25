"use server";

import { revalidatePath } from "next/cache";
import { withSystemContext } from "@/lib/db";
import { nearServiceArea } from "@/lib/geo/customer-location";
import { roundCoord } from "@/lib/geo/distance";
import { logger } from "@/lib/logger";
import { enqueueNotice } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { getCheckoutSettings } from "@/lib/settings";
import { riderDeliveredSchema, riderLocationSchema, riderMessageSchema, riderTokenSchema } from "@/lib/validation/fulfilment";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { FulfilmentError } from "./orders";
import { lockRiderJob, riderDelivered, riderPickedUp } from "./rider-job";

/**
 * What a rider does from their job link. There's no sign-in: the link itself
 * is the key, checked against the current assignment inside each
 * transaction, and every action is rate limited per order.
 */

const GONE = "This job link has expired. The shop may have given the delivery to another rider.";

function failure(err: unknown): ActionResult<never> {
  if (err instanceof FulfilmentError) return { ok: false, error: err.message };
  logger.error({ err }, "rider action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function riderName(tx: Parameters<Parameters<typeof withSystemContext>[0]>[0], riderId: string): Promise<string> {
  return (await tx.rider.findUniqueOrThrow({ where: { id: riderId }, select: { name: true } })).name;
}

export async function riderPickedUpAction(input: { token: string }): Promise<ActionResult> {
  const parsed = riderTokenSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const r = await withSystemContext(async (tx) => {
      const so = await lockRiderJob(tx, parsed.data.token);
      if (!so) throw new FulfilmentError(GONE);
      if (so.status === "delivered") throw new FulfilmentError("This order is already delivered.");
      const moved = await riderPickedUp(tx, so, await riderName(tx, so.riderId!));
      return { id: so.id, moved };
    });
    // The customer hears "on its way" with the rider's number and their code.
    if (r.moved) await enqueueNotice({ type: "order.status", sellerOrderId: r.id, status: "shipped" });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: true, message: "Marked as picked up. The customer has been told you're on the way." };
}

export async function riderDeliveredAction(input: { token: string; code: string }): Promise<ActionResult> {
  const parsed = riderDeliveredSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const id = parsed.data.token.slice(0, 22);
  // Four digits are easy to guess: five tries every 15 minutes, then wait.
  const rl = await rateLimit(`rider:code:${id}`, 5, 15 * 60);
  if (!rl.allowed) return { ok: false, error: `Too many wrong codes. Try again in ${Math.ceil(rl.retryAfterSeconds / 60)} minutes, or ask the shop to mark it delivered.` };
  try {
    const soId = await withSystemContext(async (tx) => {
      const so = await lockRiderJob(tx, parsed.data.token);
      if (!so) throw new FulfilmentError(GONE);
      const settings = await getCheckoutSettings(tx);
      await riderDelivered(tx, so, { code: parsed.data.code, riderName: await riderName(tx, so.riderId!), escrowReleaseDays: settings.escrowReleaseDays });
      return so.id;
    });
    await enqueueNotice({ type: "order.status", sellerOrderId: soId, status: "delivered" });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: true, message: "Delivered. Thank you!" };
}

export async function riderMessageAction(input: { token: string; body: string }): Promise<ActionResult> {
  const parsed = riderMessageSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const rl = await rateLimit(`rider:msg:${parsed.data.token.slice(0, 22)}`, 20, 3600);
  if (!rl.allowed) return { ok: false, error: "You've sent a lot of messages. Please call the customer or the shop instead." };
  try {
    const messageId = await withSystemContext(async (tx) => {
      const so = await lockRiderJob(tx, parsed.data.token);
      if (!so || so.status === "delivered") throw new FulfilmentError(GONE);
      const m = await tx.message.create({ data: { sellerOrderId: so.id, businessId: so.businessId, sender: "rider", senderName: (await riderName(tx, so.riderId!)).slice(0, 80), body: parsed.data.body } });
      return m.id;
    });
    await enqueueNotice({ type: "message.new", messageId });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/r/${parsed.data.token}`);
  return { ok: true };
}

/** The rider's phone shares where they are while the job page is open: the shop and TownMart see it. */
export async function riderLocationAction(input: { token: string; lat: number; lng: number }): Promise<ActionResult> {
  const parsed = riderLocationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!nearServiceArea(parsed.data)) return { ok: false, error: "Your location looks outside the area TownMart serves." };
  const rl = await rateLimit(`rider:loc:${parsed.data.token.slice(0, 22)}`, 3, 60);
  if (!rl.allowed) return { ok: true };
  try {
    await withSystemContext(async (tx) => {
      const so = await lockRiderJob(tx, parsed.data.token);
      if (!so || so.status === "delivered") throw new FulfilmentError(GONE);
      await tx.rider.update({ where: { id: so.riderId! }, data: { latitude: roundCoord(parsed.data.lat), longitude: roundCoord(parsed.data.lng), locationUpdatedAt: new Date() } });
    });
  } catch (err) {
    return failure(err);
  }
  return { ok: true };
}
