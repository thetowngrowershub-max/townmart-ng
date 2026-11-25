import { timingSafeEqual } from "node:crypto";
import type { SellerOrder } from "@prisma/client";
import { lookupHash } from "@/lib/crypto";
import type { Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { recordStatus } from "@/lib/orders/status";
import { FulfilmentError } from "./orders";

/**
 * A rider has no account. When a shop puts a rider on a delivery, the rider
 * gets one text with a private job link, and the customer gets a 4-digit
 * delivery code to give the rider at the door.
 *
 * Both come from the assignment itself (order, rider, time assigned), keyed
 * with DATA_HASH_KEY, so nothing secret is stored. Changing or removing the
 * rider changes the assignment time, which kills the old link and code.
 */

type Assignment = Pick<SellerOrder, "id" | "riderId" | "riderAssignedAt">;

const assignmentKey = (so: Assignment) => (so.riderId && so.riderAssignedAt ? `${so.id}:${so.riderId}:${so.riderAssignedAt.getTime()}` : null);

const uuidToB64 = (id: string) => Buffer.from(id.replace(/-/g, ""), "hex").toString("base64url");
function b64ToUuid(s: string): string | null {
  const hex = Buffer.from(s, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ID_LEN = 22;
const SIG_LEN = 12;

function signature(key: string): string {
  return Buffer.from(lookupHash(key, "rider-job"), "hex").subarray(0, 9).toString("base64url");
}

/** The job link's token: the seller order id, then a signature of the assignment. 34 characters. */
export function riderJobToken(so: Assignment): string | null {
  const key = assignmentKey(so);
  return key ? `${uuidToB64(so.id)}${signature(key)}` : null;
}

/** Short enough to keep the rider's text within one SMS. */
export function riderJobUrl(so: Assignment): string | null {
  const t = riderJobToken(so);
  return t ? `${env().APP_URL}/r/${t}` : null;
}

/** The seller order a token names. Check it with `tokenMatches` against the current assignment. */
export function parseRiderJobToken(token: string): string | null {
  if (typeof token !== "string" || token.length !== ID_LEN + SIG_LEN || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return b64ToUuid(token.slice(0, ID_LEN));
}

export function tokenMatches(so: Assignment, token: string): boolean {
  const expected = riderJobToken(so);
  if (!expected || expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}

/** The 4-digit code the customer gives the rider on arrival. */
export function deliveryCode(so: Assignment): string | null {
  const key = assignmentKey(so);
  if (!key) return null;
  return (parseInt(lookupHash(key, "delivery-code").slice(0, 8), 16) % 10_000).toString().padStart(4, "0");
}

/** Statuses where the rider's link still works (delivered stays readable, for the rider's own record). */
export const RIDER_LINK_STATUSES = ["paid", "processing", "shipped", "delivered"] as const;

/**
 * The seller order behind a job link, locked for update, or null if the link
 * is wrong, old (the rider was changed) or the order is finished. System scope.
 */
export async function lockRiderJob(tx: Tx, token: string): Promise<SellerOrder | null> {
  const id = parseRiderJobToken(token);
  if (!id) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM seller_orders WHERE id = ${id}::uuid FOR UPDATE`;
  if (!rows.length) return null;
  const so = await tx.sellerOrder.findUnique({ where: { id } });
  if (!so || so.deliveryMethod !== "delivery" || !tokenMatches(so, token)) return null;
  if (!(RIDER_LINK_STATUSES as readonly string[]).includes(so.status)) return null;
  return so;
}

/**
 * The rider has the items. The order goes "on its way" (from paid or
 * preparing; a shop that skipped "Start preparing" isn't held up). System scope.
 */
export async function riderPickedUp(tx: Tx, so: SellerOrder, riderName: string, now = new Date()): Promise<boolean> {
  if (so.pickedUpAt || !["paid", "processing", "shipped"].includes(so.status)) return false;
  const toShipped = so.status !== "shipped";
  await tx.sellerOrder.update({
    where: { id: so.id },
    data: { pickedUpAt: now, ...(toShipped ? { status: "shipped", shippedAt: now, carrier: so.carrier ?? riderName.slice(0, 60) } : {}) },
  });
  await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to: "shipped", note: `Picked up by rider ${riderName}` });
  return toShipped;
}

export class DeliveryCodeError extends FulfilmentError {}

/** The rider is at the door and the customer gave the code. System scope. */
export async function riderDelivered(tx: Tx, so: SellerOrder, p: { code: string; riderName: string; escrowReleaseDays: number; now?: Date }): Promise<void> {
  const now = p.now ?? new Date();
  if (so.status === "delivered") return;
  if (so.status !== "shipped" || !so.pickedUpAt) throw new FulfilmentError("Tap “Picked up” first, when you collect the items from the shop.");
  const expected = deliveryCode(so);
  const given = p.code.replace(/\D/g, "");
  if (!expected || given.length !== 4 || !timingSafeEqual(Buffer.from(expected), Buffer.from(given))) {
    throw new DeliveryCodeError("That code isn't right. Ask the customer for the 4-digit code TownMart texted them.");
  }
  await tx.sellerOrder.update({ where: { id: so.id }, data: { status: "delivered", deliveredAt: now, escrowReleaseAt: new Date(now.getTime() + p.escrowReleaseDays * 86_400_000) } });
  await recordStatus(tx, { sellerOrderId: so.id, businessId: so.businessId, from: so.status, to: "delivered", note: `Delivered by rider ${p.riderName}, code confirmed` });
}
