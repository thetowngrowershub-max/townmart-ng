"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { assertCan, AuthzError } from "@/lib/authz";
import { encrypt, phoneHash } from "@/lib/crypto";
import { nearServiceArea } from "@/lib/geo/customer-location";
import { roundCoord } from "@/lib/geo/distance";
import { logger } from "@/lib/logger";
import { enqueueNotice } from "@/lib/queue";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { openToPool } from "@/lib/riders/pool";
import { assignRiderSchema, riderAvailabilitySchema, riderIdSchema, riderModeSchema, riderSchema, sellerOrderRefSchema, shopLocationSchema, type RiderInput } from "@/lib/validation/riders";
import { FulfilmentError } from "./orders";
import { assignRider } from "./riders";

async function seller(permission: "order.manage" | "store.manage"): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, permission, { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof FulfilmentError) return { ok: false, error: err.message };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, error: "You already have a rider with this phone number.", fieldErrors: { phone: ["Already added"] } };
  logger.error({ err }, "rider action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

/** Adds a rider, or updates one. Staff who handle orders can manage riders. */
export async function saveRiderAction(input: RiderInput): Promise<ActionResult> {
  const parsed = riderSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  try {
    const ctx = await seller("order.manage");
    await withSellerRls(ctx, async (tx) => {
      const data = { name: d.name, phoneEncrypted: encrypt(d.phone), phoneHash: phoneHash(d.phone), vehicle: d.vehicle, isAvailable: d.isAvailable };
      if (d.id) {
        const { count } = await tx.rider.updateMany({ where: { id: d.id, businessId: ctx.business.id }, data });
        if (count === 0) throw new FulfilmentError("Rider not found.");
      } else {
        await tx.rider.create({ data: { ...data, businessId: ctx.business.id } });
      }
      await writeAudit(tx, { actorUserId: ctx.user.id, action: d.id ? "rider.updated" : "rider.added", entityType: "business", entityId: ctx.business.id, after: { name: d.name, vehicle: d.vehicle } });
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/dashboard/riders");
  return { ok: true, message: d.id ? "Rider updated." : "Rider added." };
}

export async function setRiderAvailableAction(input: { id: string; isAvailable: boolean }): Promise<ActionResult> {
  const parsed = riderAvailabilitySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    await withSellerRls(ctx, (tx) => tx.rider.updateMany({ where: { id: parsed.data.id, businessId: ctx.business.id }, data: { isAvailable: parsed.data.isAvailable } }));
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/dashboard/riders");
  return { ok: true };
}

/** A rider who has left: hidden from the picker, kept on past orders. */
export async function removeRiderAction(input: { id: string }): Promise<ActionResult> {
  const parsed = riderIdSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    await withSellerRls(ctx, async (tx) => {
      await tx.rider.updateMany({ where: { id: parsed.data.id, businessId: ctx.business.id }, data: { isActive: false, isAvailable: false } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "rider.removed", entityType: "business", entityId: ctx.business.id, after: { riderId: parsed.data.id } });
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/dashboard/riders");
  return { ok: true, message: "Rider removed." };
}

/** Puts one of the shop's riders on a delivery, or takes them off (riderId null). */
export async function assignRiderAction(input: { sellerOrderId: string; riderId: string | null }): Promise<ActionResult> {
  const parsed = assignRiderSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("order.manage");
    const r = await withSellerRls(ctx, (tx) => assignRider(tx, { sellerOrderId: parsed.data.sellerOrderId, businessId: ctx.business.id, riderId: parsed.data.riderId, actorUserId: ctx.user.id }));
    if (r.riderId && r.assignedAt) await enqueueNotice({ type: "rider.assigned", sellerOrderId: parsed.data.sellerOrderId, at: r.assignedAt.getTime() });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/dashboard/orders/${parsed.data.sellerOrderId}`);
  revalidatePath("/dashboard/orders");
  return { ok: true, message: parsed.data.riderId ? "Rider assigned. We've texted them the job and sent the customer their details." : "Rider removed from this order." };
}

/** The shop's pickup point, from the seller's phone while they're at the shop. */
export async function saveShopLocationAction(input: { lat: number; lng: number }): Promise<ActionResult> {
  const parsed = shopLocationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!nearServiceArea(parsed.data)) return { ok: false, error: "That location is outside the area TownMart serves. Use this button while you're at your shop." };
  try {
    const ctx = await seller("store.manage");
    const latitude = roundCoord(parsed.data.lat);
    const longitude = roundCoord(parsed.data.lng);
    await withSellerRls(ctx, async (tx) => {
      await tx.business.update({ where: { id: ctx.business.id }, data: { latitude, longitude } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "business.location_updated", entityType: "business", entityId: ctx.business.id, after: { latitude, longitude } });
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/dashboard/settings");
  return { ok: true, message: "Shop location saved. Delivery fees are now worked out from here." };
}

/** Who delivers the shop's orders by default: TownMart riders (the standard) or the shop's own. */
export async function setRiderModeAction(input: { mode: "townmart" | "own" }): Promise<ActionResult> {
  const parsed = riderModeSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await seller("store.manage");
    await withSellerRls(ctx, async (tx) => {
      await tx.business.update({ where: { id: ctx.business.id }, data: { riderMode: parsed.data.mode } });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "business.rider_mode", entityType: "business", entityId: ctx.business.id, after: { riderMode: parsed.data.mode } });
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/dashboard/riders");
  return { ok: true, message: parsed.data.mode === "townmart" ? "New deliveries go to TownMart riders. You can still use your own rider on any order." : "New deliveries wait for you to assign one of your riders. You can still ask for a TownMart rider on any order." };
}

/** One delivery to a TownMart rider, for a shop that normally uses its own (or whose rider can't make it). */
export async function requestPoolRiderAction(input: { sellerOrderId: string }): Promise<ActionResult> {
  const parsed = sellerOrderRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  let openedAt: Date | null = null;
  try {
    const ctx = await seller("order.manage");
    openedAt = await withSellerRls(ctx, async (tx) => {
      const so = await tx.sellerOrder.findFirst({ where: { id: parsed.data.sellerOrderId, businessId: ctx.business.id }, select: { id: true, riderId: true } });
      if (!so) throw new FulfilmentError("Order not found.");
      if (so.riderId) throw new FulfilmentError("Take your rider off this order first.");
      const now = new Date();
      if (!(await openToPool(tx, so.id, now))) throw new FulfilmentError("This order is already with TownMart riders, or past the point of needing one.");
      return now;
    });
  } catch (err) {
    return failure(err);
  }
  if (openedAt) await enqueueNotice({ type: "rider.pool_offer", sellerOrderId: parsed.data.sellerOrderId, at: openedAt.getTime() });
  revalidatePath(`/dashboard/orders/${parsed.data.sellerOrderId}`);
  return { ok: true, message: "Sent to TownMart riders nearby. The first to take it will appear here." };
}
