"use server";

import { revalidatePath } from "next/cache";
import { decrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { FulfilmentError } from "@/lib/fulfilment/orders";
import { assignRider } from "@/lib/fulfilment/riders";
import { enqueueNotice, enqueueSms } from "@/lib/queue";
import { OPEN_JOB_STATUSES, riderPay, type PoolRiderStatus } from "@/lib/riders/pool";
import { getCheckoutSettings } from "@/lib/settings";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { adminPoolAssignSchema, riderReviewSchema, sellerOrderRefSchema } from "@/lib/validation/riders";
import { AdminError, adminContext, adminFailure } from "./context";

/** TownMart vets pool riders and can put one on any delivery. Admin scope. */

const MOVES: Record<"approve" | "reject" | "suspend" | "restore", { from: readonly PoolRiderStatus[]; to: PoolRiderStatus }> = {
  approve: { from: ["pending", "rejected"], to: "approved" },
  reject: { from: ["pending"], to: "rejected" },
  suspend: { from: ["approved"], to: "suspended" },
  restore: { from: ["suspended"], to: "approved" },
};

const failure = (err: unknown, what: string) => (err instanceof FulfilmentError ? { ok: false as const, error: err.message } : adminFailure(err, what));

export async function reviewRiderAction(input: { id: string; decision: string; note?: string }): Promise<ActionResult> {
  const parsed = riderReviewSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  const move = MOVES[d.decision];
  if ((d.decision === "reject" || d.decision === "suspend") && d.note.length < 3) return { ok: false, error: "Say why, so the rider knows what to fix.", fieldErrors: { note: ["Required"] } };
  let text: { to: string; body: string } | null = null;
  try {
    const { actor, run } = await adminContext("rider.manage");
    await run(async (tx, audit) => {
      const r = await tx.rider.findFirst({ where: { id: d.id, businessId: null } });
      if (!r) throw new AdminError("Rider not found.");
      if (!(move.from as readonly string[]).includes(r.status)) throw new AdminError(`This rider is ${r.status}, so they can't be moved that way. Refresh the page.`);
      if (d.decision === "suspend") {
        const held = await tx.sellerOrder.count({ where: { riderId: r.id, status: { in: ["paid", "processing", "shipped"] } } });
        if (held > 0) throw new AdminError(`This rider has ${held} deliver${held === 1 ? "y" : "ies"} in hand. Move them to another rider on the Deliveries page first.`);
      }
      await tx.rider.update({
        where: { id: r.id },
        data: { status: move.to, reviewedAt: new Date(), reviewedByUserId: actor.id, reviewNote: d.note || null, ...(move.to !== "approved" ? { isAvailable: false } : {}) },
      });
      await audit(`rider.${d.decision}`, "rider", r.id, { status: move.to, note: d.note || null }, { status: r.status });
      const phone = decrypt(r.phoneEncrypted);
      if (move.to === "approved") text = { to: phone, body: `TownMart: you're approved as a TownMart rider. Sign in and go online to get jobs: ${env().APP_URL}/rider` };
      else if (move.to === "rejected") text = { to: phone, body: `TownMart: we couldn't approve your rider application yet. See why and apply again: ${env().APP_URL}/rider` };
      else text = { to: phone, body: `TownMart: your rider account is paused. Please contact TownMart.` };
    });
  } catch (err) {
    return failure(err, "rider review");
  }
  if (text) await enqueueSms(text);
  revalidatePath("/admin/riders");
  return { ok: true, message: { approve: "Rider approved and told by text.", reject: "Application declined. The rider was told by text.", suspend: "Rider suspended.", restore: "Rider restored." }[d.decision] };
}

/** Puts a TownMart rider on a delivery (any shop), for when nobody has taken it or a rider dropped out. */
export async function adminAssignPoolRiderAction(input: { sellerOrderId: string; riderId: string }): Promise<ActionResult> {
  const parsed = adminPoolAssignSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  let at: Date | null = null;
  try {
    const { actor, run } = await adminContext("rider.manage");
    at = await run(async (tx, audit) => {
      const so = await tx.sellerOrder.findUnique({ where: { id: parsed.data.sellerOrderId }, select: { id: true, businessId: true, deliveryKobo: true, pickedUpAt: true } });
      if (!so) throw new AdminError("Order not found.");
      if (so.pickedUpAt) throw new AdminError("This delivery has already been picked up.");
      const s = await getCheckoutSettings(tx);
      const r = await assignRider(tx, { sellerOrderId: so.id, businessId: so.businessId, riderId: parsed.data.riderId, actorUserId: actor.id, pool: { payKobo: riderPay(so.deliveryKobo, s.riderPoolSharePercent) } });
      await audit("delivery.pool_rider_assigned", "seller_order", so.id, { riderId: parsed.data.riderId });
      return r.assignedAt;
    });
  } catch (err) {
    return failure(err, "assign pool rider");
  }
  if (at) await enqueueNotice({ type: "rider.assigned", sellerOrderId: parsed.data.sellerOrderId, at: at.getTime() });
  revalidatePath("/admin/deliveries");
  return { ok: true, message: "Rider assigned. They've been texted the job." };
}

/** Offers a delivery to the pool again (or for the first time): the nearest online riders get a fresh text. */
export async function adminOfferToPoolAction(input: { sellerOrderId: string }): Promise<ActionResult> {
  const parsed = sellerOrderRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  let at: Date | null = null;
  try {
    const { run } = await adminContext("rider.manage");
    at = await run(async (tx, audit) => {
      const now = new Date();
      const { count } = await tx.sellerOrder.updateMany({
        where: { id: parsed.data.sellerOrderId, deliveryMethod: "delivery", riderId: null, status: { in: [...OPEN_JOB_STATUSES] } },
        data: { riderPoolOpenedAt: now },
      });
      if (count === 0) throw new AdminError("This delivery already has a rider or has moved on.");
      await audit("delivery.offered_to_pool", "seller_order", parsed.data.sellerOrderId);
      return now;
    });
  } catch (err) {
    return failure(err, "offer to pool");
  }
  if (at) await enqueueNotice({ type: "rider.pool_offer", sellerOrderId: parsed.data.sellerOrderId, at: at.getTime() });
  revalidatePath("/admin/deliveries");
  return { ok: true, message: "Offered to TownMart riders. The nearest online riders have been texted." };
}
