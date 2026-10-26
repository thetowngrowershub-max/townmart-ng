import type { Booking, BookingStatus } from "@prisma/client";
import { formatBookingTime } from "@/lib/datetime";
import type { Tx } from "@/lib/db";
import { settleBookingOrder } from "@/lib/fulfilment/orders";
import { getCheckoutSettings } from "@/lib/settings";
import { claimSlot, SlotTakenError } from "./schedule";
import { moveBooking, recordBookingStatus } from "./status";

export class BookingError extends Error {}

export type SellerBookingStep = "confirm" | "start" | "complete" | "no_show";

/** Steps the seller takes under RLS; guard_booking_status allows exactly these for them. */
const SELLER_STEPS: Record<SellerBookingStep, { from: BookingStatus; to: BookingStatus; note: string }> = {
  confirm: { from: "requested", to: "confirmed", note: "Confirmed by the provider" },
  start: { from: "confirmed", to: "in_progress", note: "Started" },
  complete: { from: "in_progress", to: "completed", note: "Done" },
  no_show: { from: "confirmed", to: "no_show", note: "Customer didn't show up" },
};

/** What a seller can do with a booking now. */
export function sellerBookingSteps(b: Pick<Booking, "status" | "startsAt">, now = new Date()): SellerBookingStep[] {
  switch (b.status) {
    case "requested":
      return ["confirm"];
    case "confirmed":
      // A no-show can only be called once the time has come.
      return b.startsAt <= now ? ["start", "no_show"] : ["start"];
    case "in_progress":
      return ["complete"];
    default:
      return [];
  }
}

async function lockBooking(tx: Tx, id: string, businessId?: string): Promise<Booking> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM bookings WHERE id = ${id}::uuid FOR UPDATE`;
  const b = rows.length ? await tx.booking.findUnique({ where: { id } }) : null;
  if (!b || (businessId && b.businessId !== businessId)) throw new BookingError("Booking not found.");
  return b;
}

/** A seller step, in the seller's RLS transaction. */
export async function sellerBookingStep(tx: Tx, p: { bookingId: string; businessId: string; step: SellerBookingStep; actorUserId: string; now?: Date }): Promise<Booking> {
  const b = await lockBooking(tx, p.bookingId, p.businessId);
  if (!sellerBookingSteps(b, p.now).includes(p.step)) throw new BookingError("This booking has already moved on. Refresh the page to see its status.");
  const s = SELLER_STEPS[p.step];
  await moveBooking(tx, b, s.to, s.note, p.actorUserId);
  return { ...b, status: s.to };
}

/** After a booking ends one way or another, a booking-only seller order may be finished too. System scope. */
export async function afterBookingEnded(tx: Tx, sellerOrderId: string): Promise<void> {
  const settings = await getCheckoutSettings(tx);
  await settleBookingOrder(tx, sellerOrderId, settings.escrowReleaseDays);
}

/**
 * Cancels a booking (system scope). Sellers can decline a request or cancel a
 * confirmed booking; customers can cancel before the start time. Money owed
 * back follows the refund policy and is paid through Phase 5 refunds; the
 * history note records who cancelled and when, which decides the refund.
 */
export async function cancelBooking(tx: Tx, p: { bookingId: string; by: "seller" | "customer"; businessId?: string; customerUserId?: string | null; orderId?: string; actorUserId: string | null; reason: string; now?: Date }): Promise<Booking> {
  const now = p.now ?? new Date();
  const b = await lockBooking(tx, p.bookingId, p.businessId);
  if (p.orderId && b.orderId !== p.orderId) throw new BookingError("Booking not found.");
  if (!["requested", "confirmed"].includes(b.status)) throw new BookingError("This booking can't be cancelled any more.");
  if (p.by === "customer" && b.startsAt <= now) throw new BookingError("This booking has already started. Message the provider instead.");
  const hoursBefore = Math.floor((b.startsAt.getTime() - now.getTime()) / 3_600_000);
  const who = p.by === "seller" ? (b.status === "requested" ? "Declined by the provider" : "Cancelled by the provider") : "Cancelled by the customer";
  await moveBooking(tx, b, "cancelled", `${who}, ${hoursBefore} hours before the start`, p.actorUserId, { cancelReason: p.reason });
  await afterBookingEnded(tx, b.sellerOrderId);
  return { ...b, status: "cancelled" };
}

/**
 * Moves a booking to a new time (system scope). The new time is claimed like
 * a new booking (the booking's own place doesn't count against it); the
 * history records the move as "rescheduled" with both times.
 */
export async function rescheduleBooking(tx: Tx, p: { bookingId: string; by: "seller" | "customer"; businessId?: string; orderId?: string; actorUserId: string | null; startsAt: Date; now?: Date }): Promise<Booking> {
  const now = p.now ?? new Date();
  const b = await lockBooking(tx, p.bookingId, p.businessId);
  if (p.orderId && b.orderId !== p.orderId) throw new BookingError("Booking not found.");
  if (!["requested", "confirmed"].includes(b.status)) throw new BookingError("This booking can't be moved any more.");
  if (b.startsAt <= now) throw new BookingError("This booking has already started.");
  if (p.startsAt.getTime() === b.startsAt.getTime()) throw new BookingError("Choose a different time.");
  const settings = await getCheckoutSettings(tx);
  if (p.startsAt.getTime() > now.getTime() + (settings.bookingDaysAhead + 1) * 86_400_000) throw new BookingError("Choose a time within the booking window.");
  const durationMinutes = (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000;
  let place;
  try {
    // The provider may move a booking at short notice; customers keep the usual lead time.
    place = await claimSlot(tx, { serviceId: b.serviceId, startsAt: p.startsAt, durationMinutes, leadMinutes: p.by === "seller" ? 0 : settings.bookingLeadMinutes, now, ignoreBookingId: b.id });
  } catch (err) {
    if (err instanceof SlotTakenError) throw new BookingError("That time isn't available. Please pick another.");
    throw err;
  }
  // A customer's move goes back to the provider to confirm if they confirm bookings; the provider's own move stands.
  const service = await tx.service.findUniqueOrThrow({ where: { id: b.serviceId }, select: { requiresConfirmation: true } });
  const status: BookingStatus = p.by === "customer" && service.requiresConfirmation ? "requested" : "confirmed";
  const who = p.by === "seller" ? "provider" : "customer";
  const moved = await tx.booking.update({
    where: { id: b.id },
    data: { startsAt: p.startsAt, endsAt: place.endsAt, slotNo: place.slotNo, capacity: place.capacity, status, previousStartsAt: b.startsAt, reminder24SentAt: null, reminder1SentAt: null },
  });
  await recordBookingStatus(tx, { bookingId: b.id, businessId: b.businessId, from: b.status, to: "rescheduled", actorUserId: p.actorUserId, note: `Moved by the ${who} from ${formatBookingTime(b.startsAt)} to ${formatBookingTime(p.startsAt)}` });
  await recordBookingStatus(tx, { bookingId: b.id, businessId: b.businessId, from: "rescheduled", to: status, actorUserId: p.actorUserId, note: status === "requested" ? "Waiting for the provider to confirm the new time" : undefined });
  return moved;
}
