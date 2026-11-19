"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { assertCan, AuthzError } from "@/lib/authz";
import { encrypt, phoneHash } from "@/lib/crypto";
import { nearServiceArea } from "@/lib/geo/customer-location";
import { roundCoord } from "@/lib/geo/distance";
import { logger } from "@/lib/logger";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { assignRiderSchema, riderAvailabilitySchema, riderIdSchema, riderSchema, shopLocationSchema, type RiderInput } from "@/lib/validation/riders";
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
    await withSellerRls(ctx, (tx) => assignRider(tx, { sellerOrderId: parsed.data.sellerOrderId, businessId: ctx.business.id, riderId: parsed.data.riderId, actorUserId: ctx.user.id }));
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/dashboard/orders/${parsed.data.sellerOrderId}`);
  revalidatePath("/dashboard/orders");
  return { ok: true, message: parsed.data.riderId ? "Rider assigned." : "Rider removed from this order." };
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
