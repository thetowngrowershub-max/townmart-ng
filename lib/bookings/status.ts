import type { BookingStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  held: "Awaiting payment",
  requested: "Waiting for the provider",
  confirmed: "Confirmed",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  no_show: "Missed",
  rescheduled: "Moved to a new time",
};

/** Appends to booking_status_history. Every booking status change goes through here. */
export async function recordBookingStatus(
  tx: Tx,
  p: { bookingId: string; businessId: string; from: BookingStatus | null; to: BookingStatus; actorUserId?: string | null; note?: string },
): Promise<void> {
  await tx.bookingStatusHistory.create({
    data: { bookingId: p.bookingId, businessId: p.businessId, fromStatus: p.from, toStatus: p.to, actorUserId: p.actorUserId ?? null, note: p.note ?? null },
  });
}

/** Moves a booking to a new status, with history. The caller holds whatever lock it needs. */
export async function moveBooking(tx: Tx, booking: { id: string; businessId: string; status: BookingStatus }, to: BookingStatus, note: string, actorUserId: string | null = null, extra: { cancelReason?: string | null; holdExpiresAt?: Date | null } = {}): Promise<void> {
  await tx.booking.update({ where: { id: booking.id }, data: { status: to, ...extra } });
  await recordBookingStatus(tx, { bookingId: booking.id, businessId: booking.businessId, from: booking.status, to, actorUserId, note });
}

/** The status a paid (or pay-on-delivery) booking starts in: the provider confirms it, or it's confirmed straight away. */
export const startingStatus = (requiresConfirmation: boolean): BookingStatus => (requiresConfirmation ? "requested" : "confirmed");
