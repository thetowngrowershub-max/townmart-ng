"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { encrypt, phoneHash } from "@/lib/crypto";
import { withRls, withSystemContext } from "@/lib/db";
import { FulfilmentError } from "@/lib/fulfilment/orders";
import { nearServiceArea } from "@/lib/geo/customer-location";
import { roundCoord } from "@/lib/geo/distance";
import { logger } from "@/lib/logger";
import { enqueueNotice } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { getCheckoutSettings } from "@/lib/settings";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { onlineSchema, poolApplicationSchema, sellerOrderRefSchema, type PoolApplicationInput } from "@/lib/validation/riders";
import { shopLocationSchema } from "@/lib/validation/riders";
import { acceptPoolJob, dropPoolJob, getPoolRider, poolRiderForUser } from "./pool";

/**
 * What a TownMart pool rider does in the /rider area: apply, go online or
 * offline, share where they are, and take or hand back jobs. Every action
 * checks the signed-in user first; jobs are read and taken in the system
 * scope because they belong to other businesses.
 */

class NotRider extends FulfilmentError {}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof FulfilmentError) return { ok: false, error: err.message };
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { ok: false, error: "A TownMart rider with this phone number already exists.", fieldErrors: { phone: ["Already registered"] } };
  }
  logger.error({ err }, "pool rider action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

async function signedIn() {
  const user = await getCurrentUser();
  if (!user) throw new NotRider("Please sign in first.");
  return user;
}

/** The signed-in user's approved pool rider, or an error. */
async function approvedRider() {
  const user = await signedIn();
  const rider = await withRls({ userId: user.id }, (tx) => getPoolRider(tx, user.id));
  if (!rider) throw new NotRider("Your rider account isn't approved for jobs right now.");
  return { user, rider };
}

/** Sends (or resends, while pending or after a rejection) an application to ride for TownMart. */
export async function applyAsRiderAction(input: PoolApplicationInput): Promise<ActionResult> {
  const parsed = poolApplicationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const d = parsed.data;
  try {
    const user = await signedIn();
    const rl = await rateLimit(`rider:apply:${user.id}`, 5, 3600);
    if (!rl.allowed) return { ok: false, error: "Too many tries. Please wait a while and try again." };
    // System scope after the sign-in check: a rejected rider applying again goes back to "pending", which is TownMart's change to make.
    await withSystemContext(async (tx) => {
      const existing = await poolRiderForUser(tx, user.id);
      if (existing && existing.status !== "pending" && existing.status !== "rejected") {
        throw new FulfilmentError(existing.status === "approved" ? "You're already a TownMart rider." : "Your rider account is suspended. Please contact TownMart.");
      }
      const data = {
        name: d.name,
        phoneEncrypted: encrypt(d.phone),
        phoneHash: phoneHash(d.phone),
        vehicle: d.vehicle,
        plateNumber: d.plateNumber || null,
        homeTown: d.homeTown,
        ninEncrypted: d.nin ? encrypt(d.nin) : null,
        guarantorName: d.guarantorName,
        guarantorPhoneEncrypted: encrypt(d.guarantorPhone),
        appliedAt: new Date(),
        isAvailable: false,
      };
      if (existing) {
        await tx.rider.update({ where: { id: existing.id }, data: { ...data, status: "pending", reviewedAt: null, reviewedByUserId: null } });
      } else {
        await tx.rider.create({ data: { ...data, businessId: null, userId: user.id, status: "pending" } });
      }
      await writeAudit(tx, { actorUserId: user.id, action: existing ? "rider.reapplied" : "rider.applied", entityType: "user", entityId: user.id, after: { vehicle: d.vehicle, homeTown: d.homeTown } });
    });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/rider");
  return { ok: true, message: "Application sent. TownMart will call you and your guarantor, then text you when you're approved." };
}

/** Online: nearby jobs are texted to you and you can take them. Offline: no texts. */
export async function setOnlineAction(input: { online: boolean }): Promise<ActionResult> {
  const parsed = onlineSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { user, rider } = await approvedRider();
    await withRls({ userId: user.id }, (tx) => tx.rider.update({ where: { id: rider.id }, data: { isAvailable: parsed.data.online } }));
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/rider");
  return { ok: true, message: parsed.data.online ? "You're online. We'll text you when a job comes up near you." : "You're offline. You won't get new jobs." };
}

/** The rider's phone shares where they are while the rider area is open, so the nearest rider is offered each job. */
export async function updateRiderLocationAction(input: { lat: number; lng: number }): Promise<ActionResult> {
  const parsed = shopLocationSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!nearServiceArea(parsed.data)) return { ok: false, error: "Your location looks outside the area TownMart serves." };
  try {
    const { user, rider } = await approvedRider();
    const rl = await rateLimit(`rider:pool-loc:${rider.id}`, 3, 60);
    if (!rl.allowed) return { ok: true };
    await withRls({ userId: user.id }, (tx) =>
      tx.rider.update({ where: { id: rider.id }, data: { latitude: roundCoord(parsed.data.lat), longitude: roundCoord(parsed.data.lng), locationUpdatedAt: new Date() } }),
    );
  } catch (err) {
    return failure(err);
  }
  return { ok: true };
}

/** Takes an open job. The first rider to tap gets it; the job link comes by text and appears on the jobs page. */
export async function acceptJobAction(input: { sellerOrderId: string }): Promise<ActionResult> {
  const parsed = sellerOrderRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { rider } = await approvedRider();
    const at = await withSystemContext(async (tx) => {
      const s = await getCheckoutSettings(tx);
      return acceptPoolJob(tx, { riderId: rider.id, sellerOrderId: parsed.data.sellerOrderId, sharePercent: s.riderPoolSharePercent, maxJobs: s.riderPoolMaxJobs });
    });
    await enqueueNotice({ type: "rider.assigned", sellerOrderId: parsed.data.sellerOrderId, at: at.getTime() });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/rider");
  return { ok: true, message: "The job is yours. Open it below for the pickup and drop-off." };
}

/** Hands a job back before pickup: it goes to the next rider. */
export async function dropJobAction(input: { sellerOrderId: string }): Promise<ActionResult> {
  const parsed = sellerOrderRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { user, rider } = await approvedRider();
    const reopenedAt = await withSystemContext(async (tx) => {
      await dropPoolJob(tx, { riderId: rider.id, userId: user.id, sellerOrderId: parsed.data.sellerOrderId });
      return (await tx.sellerOrder.findUniqueOrThrow({ where: { id: parsed.data.sellerOrderId }, select: { riderPoolOpenedAt: true } })).riderPoolOpenedAt!;
    });
    await enqueueNotice({ type: "rider.pool_offer", sellerOrderId: parsed.data.sellerOrderId, at: reopenedAt.getTime() });
  } catch (err) {
    return failure(err);
  }
  revalidatePath("/rider");
  return { ok: true, message: "Job handed back. Another rider will be offered it." };
}
