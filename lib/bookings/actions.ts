"use server";

import { revalidatePath } from "next/cache";
import { assertCan, AuthzError } from "@/lib/authz";
import { formatTime } from "@/lib/datetime";
import { withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { findViewableOrder } from "@/lib/orders/access";
import { enqueueNotice } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { getCheckoutSettings } from "@/lib/settings";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { slotsQuerySchema } from "@/lib/validation/cart";
import { getSellerContext, withSellerRls, type SellerContext } from "@/lib/seller/context";
import {
  bookingStepSchema,
  customerCancelBookingSchema,
  customerRescheduleSchema,
  sellerCancelBookingSchema,
  sellerRescheduleSchema,
} from "@/lib/validation/fulfilment";
import { afterBookingEnded, BookingError, cancelBooking, rescheduleBooking, sellerBookingStep } from "./manage";
import { openSlots } from "./schedule";
import { lagosMidnight } from "./slots";

export type SlotDay = { date: string; label: string; times: { startsAt: string; label: string; remaining: number }[] };

const dayLabel = new Intl.DateTimeFormat("en-NG", { timeZone: "Africa/Lagos", weekday: "short", day: "numeric", month: "short" });

/**
 * Open booking times for a service over one week, grouped by Lagos day. Only
 * times and how many places are left come back: never who booked.
 */
export async function serviceSlotsAction(input: { serviceId: string; packageId?: string | null; from?: string }): Promise<ActionResult<{ days: SlotDay[]; from: string; prev: string | null; next: string | null }>> {
  const parsed = slotsQuerySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const meta = await requestMeta();
  if (!(await rateLimit(`slots:${meta.ipHash}`, 60, 60)).allowed) return { ok: false, error: "You're going a bit fast. Please wait a moment." };

  return withSystemContext(async (tx) => {
    const service = await tx.service.findFirst({
      where: { id: parsed.data.serviceId, status: "active", deletedAt: null, takenDownAt: null, business: { status: "approved" } },
      select: { id: true, durationMinutes: true, packages: { select: { id: true, durationMinutes: true } } },
    });
    if (!service) return { ok: false as const, error: "This service is no longer available." };
    const pkg = parsed.data.packageId ? service.packages.find((p) => p.id === parsed.data.packageId) : undefined;
    const settings = await getCheckoutSettings(tx);
    const now = new Date();
    const today = lagosMidnight(now);
    const last = new Date(today.getTime() + settings.bookingDaysAhead * 86_400_000);
    let from = parsed.data.from ? new Date(`${parsed.data.from}T00:00:00+01:00`) : today;
    if (Number.isNaN(from.getTime()) || from < today) from = today;
    if (from > last) from = lagosMidnight(last);
    const days = Math.max(1, Math.min(7, Math.ceil((last.getTime() - from.getTime()) / 86_400_000) + 1));

    const slots = await openSlots(tx, { serviceId: service.id, durationMinutes: pkg?.durationMinutes ?? service.durationMinutes, from, days, leadMinutes: settings.bookingLeadMinutes, now });
    const out: SlotDay[] = [];
    for (let d = 0; d < days; d++) {
      const start = new Date(from.getTime() + d * 86_400_000);
      const end = new Date(start.getTime() + 86_400_000);
      out.push({
        date: isoDate(start),
        label: dayLabel.format(start),
        times: slots.filter((s) => s.startsAt >= start && s.startsAt < end).map((s) => ({ startsAt: s.startsAt.toISOString(), label: formatTime(s.startsAt), remaining: s.remaining })),
      });
    }
    const prevStart = new Date(from.getTime() - 7 * 86_400_000);
    const nextStart = new Date(from.getTime() + 7 * 86_400_000);
    return {
      ok: true as const,
      data: { days: out, from: isoDate(from), prev: from > today ? isoDate(prevStart < today ? today : prevStart) : null, next: nextStart <= last ? isoDate(nextStart) : null },
    };
  });
}

/** The Lagos calendar date of a Lagos midnight, as YYYY-MM-DD. */
const isoDate = (lagosMidnightUtc: Date) => new Date(lagosMidnightUtc.getTime() + 3_600_000).toISOString().slice(0, 10);

// ── Managing bookings ───────────────────────────────────────────────────────

async function provider(): Promise<SellerContext> {
  const ctx = await getSellerContext();
  if (!ctx) throw new AuthzError(401, "Please sign in to your seller account.");
  assertCan(ctx.user, "booking.manage", { businessId: ctx.business.id });
  return ctx;
}

function failure(err: unknown): ActionResult<never> {
  if (err instanceof AuthzError || err instanceof BookingError) return { ok: false, error: err.message };
  if (err instanceof Error && /can't move a booking/.test(err.message)) return { ok: false, error: "This booking has already moved on. Refresh the page to see its status." };
  logger.error({ err }, "booking action failed");
  return { ok: false, error: "Something went wrong. Please try again." };
}

function refreshSeller(sellerOrderId?: string) {
  revalidatePath("/dashboard/bookings");
  revalidatePath("/dashboard/orders");
  if (sellerOrderId) revalidatePath(`/dashboard/orders/${sellerOrderId}`);
}

/** Confirm, start, complete or mark a no-show (seller, under RLS). */
export async function bookingStepAction(input: { bookingId: string; step: string }): Promise<ActionResult> {
  const parsed = bookingStepSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await provider();
    const b = await withSellerRls(ctx, (tx) => sellerBookingStep(tx, { bookingId: parsed.data.bookingId, businessId: ctx.business.id, step: parsed.data.step, actorUserId: ctx.user.id }));
    if (b.status === "completed" || b.status === "no_show") await withSystemContext((tx) => afterBookingEnded(tx, b.sellerOrderId));
    await enqueueNotice({ type: "booking.status", bookingId: b.id, status: b.status, by: "seller" });
    refreshSeller(b.sellerOrderId);
    return { ok: true };
  } catch (err) {
    return failure(err);
  }
}

/** Decline a request or cancel a confirmed booking (seller). */
export async function sellerCancelBookingAction(input: { bookingId: string; reason: string }): Promise<ActionResult> {
  const parsed = sellerCancelBookingSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await provider();
    const b = await withSystemContext((tx) => cancelBooking(tx, { bookingId: parsed.data.bookingId, by: "seller", businessId: ctx.business.id, actorUserId: ctx.user.id, reason: parsed.data.reason }));
    await enqueueNotice({ type: "booking.status", bookingId: b.id, status: "cancelled", by: "seller" });
    refreshSeller(b.sellerOrderId);
    return { ok: true, message: "Booking cancelled. The customer has been told." };
  } catch (err) {
    return failure(err);
  }
}

/** Move a booking to another free time (seller). */
export async function sellerRescheduleAction(input: { bookingId: string; startsAt: string }): Promise<ActionResult> {
  const parsed = sellerRescheduleSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const ctx = await provider();
    const b = await withSystemContext((tx) => rescheduleBooking(tx, { bookingId: parsed.data.bookingId, by: "seller", businessId: ctx.business.id, actorUserId: ctx.user.id, startsAt: new Date(parsed.data.startsAt) }));
    await enqueueNotice({ type: "booking.status", bookingId: b.id, status: "rescheduled", by: "seller", ref: b.startsAt.toISOString() });
    refreshSeller(b.sellerOrderId);
    return { ok: true, message: "Booking moved. The customer has been told." };
  } catch (err) {
    return failure(err);
  }
}

async function customerOrder(orderNumber: string, token: string | null | undefined) {
  const meta = await requestMeta();
  if (!(await rateLimit(`booking-change:${meta.ipHash}`, 20, 600)).allowed) throw new BookingError("Too many changes. Please wait a few minutes.");
  const order = await findViewableOrder(orderNumber, token);
  if (!order) throw new BookingError("We couldn't find that order.");
  return order;
}

function refreshCustomer(orderNumber: string) {
  revalidatePath(`/account/orders/${orderNumber}`);
  revalidatePath("/account/bookings");
  revalidatePath(`/checkout/complete/${orderNumber}`);
}

/** The customer cancels a booking before it starts. */
export async function customerCancelBookingAction(input: { orderNumber: string; token?: string | null; bookingId: string; reason?: string }): Promise<ActionResult> {
  const parsed = customerCancelBookingSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const order = await customerOrder(parsed.data.orderNumber, parsed.data.token);
    const b = await withSystemContext((tx) =>
      cancelBooking(tx, { bookingId: parsed.data.bookingId, by: "customer", orderId: order.id, actorUserId: order.userId, reason: parsed.data.reason || "Cancelled by the customer" }),
    );
    await enqueueNotice({ type: "booking.status", bookingId: b.id, status: "cancelled", by: "customer" });
    refreshCustomer(parsed.data.orderNumber);
    return { ok: true, message: "Booking cancelled. Any refund due follows our Refund Policy." };
  } catch (err) {
    return failure(err);
  }
}

/** The customer moves a booking to another free time. */
export async function customerRescheduleAction(input: { orderNumber: string; token?: string | null; bookingId: string; startsAt: string }): Promise<ActionResult> {
  const parsed = customerRescheduleSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const order = await customerOrder(parsed.data.orderNumber, parsed.data.token);
    const b = await withSystemContext((tx) => rescheduleBooking(tx, { bookingId: parsed.data.bookingId, by: "customer", orderId: order.id, actorUserId: order.userId, startsAt: new Date(parsed.data.startsAt) }));
    await enqueueNotice({ type: "booking.status", bookingId: b.id, status: "rescheduled", by: "customer", ref: b.startsAt.toISOString() });
    refreshCustomer(parsed.data.orderNumber);
    return { ok: true, message: "Booking moved." };
  } catch (err) {
    return failure(err);
  }
}
