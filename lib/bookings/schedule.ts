import type { Tx } from "@/lib/db";
import { findSlot, generateSlots, type Interval, type Slot, type WeeklyWindow } from "./slots";

/** Booking statuses that hold a place (the same list as the exclusion constraint). */
export const ACTIVE_BOOKING_STATUSES = ["held", "requested", "confirmed", "in_progress"] as const;

export type Schedule = { windows: WeeklyWindow[]; blackouts: Interval[]; booked: Interval[] };

export async function loadSchedule(tx: Tx, serviceId: string, from: Date, to: Date): Promise<Schedule> {
  const [windows, blackouts, booked] = await Promise.all([
    tx.serviceAvailability.findMany({ where: { serviceId } }),
    tx.serviceBlackout.findMany({ where: { serviceId, endsAt: { gt: from }, startsAt: { lt: to } } }),
    tx.booking.findMany({
      where: { serviceId, status: { in: [...ACTIVE_BOOKING_STATUSES] }, endsAt: { gt: from }, startsAt: { lt: to } },
      select: { startsAt: true, endsAt: true },
    }),
  ]);
  return {
    windows: windows.map((w) => ({ weekday: w.weekday, startMinute: w.startMinute, endMinute: w.endMinute, slotMinutes: w.slotMinutes, bufferMinutes: w.bufferMinutes, maxPerSlot: w.maxPerSlot })),
    blackouts: blackouts.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt })),
    booked,
  };
}

/** Open times for a service over the next `days` days. Runs in the system scope (bookings are private). */
export async function openSlots(tx: Tx, params: { serviceId: string; durationMinutes: number; from: Date; days: number; leadMinutes: number; now?: Date }): Promise<Slot[]> {
  const now = params.now ?? new Date();
  const to = new Date(params.from.getTime() + params.days * 86_400_000);
  const schedule = await loadSchedule(tx, params.serviceId, params.from, new Date(to.getTime() + 86_400_000));
  return generateSlots({ ...schedule, durationMinutes: params.durationMinutes, from: params.from, to, earliest: new Date(now.getTime() + params.leadMinutes * 60_000), onlyOpen: true });
}

export class SlotTakenError extends Error {}

/**
 * Picks a capacity place for a booking at `startsAt`, inside the caller's
 * transaction. Serialises bookings of the same service with an advisory lock,
 * re-checks the time against the weekly hours, blackouts and other bookings,
 * and returns the lowest free place. The insert that follows is still checked
 * by the exclusion constraint.
 */
export async function claimSlot(
  tx: Tx,
  params: { serviceId: string; startsAt: Date; durationMinutes: number; leadMinutes: number; now: Date; ignoreBookingId?: string },
): Promise<{ endsAt: Date; slotNo: number; capacity: number }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${params.serviceId}, 0))`;
  const endsAt = new Date(params.startsAt.getTime() + params.durationMinutes * 60_000);
  const schedule = await loadSchedule(tx, params.serviceId, new Date(params.startsAt.getTime() - 86_400_000), new Date(endsAt.getTime() + 86_400_000));
  const others = await tx.booking.findMany({
    where: {
      serviceId: params.serviceId,
      status: { in: [...ACTIVE_BOOKING_STATUSES] },
      startsAt: { lt: endsAt },
      endsAt: { gt: params.startsAt },
      ...(params.ignoreBookingId ? { id: { not: params.ignoreBookingId } } : {}),
    },
    select: { slotNo: true, startsAt: true, endsAt: true },
  });
  const slot = findSlot(
    { ...schedule, booked: others, durationMinutes: params.durationMinutes, earliest: new Date(params.now.getTime() + params.leadMinutes * 60_000) },
    params.startsAt,
  );
  if (!slot || slot.remaining <= 0) throw new SlotTakenError("That time is no longer available.");
  const used = new Set(others.map((o) => o.slotNo));
  for (let n = 1; n <= slot.capacity; n++) if (!used.has(n)) return { endsAt, slotNo: n, capacity: slot.capacity };
  throw new SlotTakenError("That time is no longer available.");
}
