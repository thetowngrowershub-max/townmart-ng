import { withSystemContext } from "@/lib/db";
import { sendBookingReminder } from "@/lib/fulfilment/notify";

const HOUR = 3_600_000;

/**
 * Reminds both sides of confirmed bookings about 24 hours and 1 hour before
 * they start. Each reminder is claimed by setting its "sent" column first, so
 * a booking is reminded once even if two runs overlap. A booking made less
 * than 24 hours ahead only gets the 1-hour reminder. Moving a booking clears
 * both columns, so the new time is reminded again.
 */
export async function sendBookingReminders(now = new Date()): Promise<{ day: number; hour: number }> {
  const sent = { day: 0, hour: 0 };
  for (const which of ["hour", "day"] as const) {
    const window = which === "day" ? 24 * HOUR : HOUR;
    const sentCol = which === "day" ? "reminder24SentAt" : "reminder1SentAt";
    const due = await withSystemContext((tx) =>
      tx.booking.findMany({
        where: {
          status: "confirmed",
          // The day-before reminder is skipped when the hour reminder is already due.
          startsAt: { gt: which === "day" ? new Date(now.getTime() + HOUR) : now, lte: new Date(now.getTime() + window) },
          [sentCol]: null,
        },
        select: { id: true },
        take: 500,
      }),
    );
    for (const b of due) {
      const claimed = await withSystemContext(async (tx) => {
        const { count } = await tx.booking.updateMany({ where: { id: b.id, status: "confirmed", [sentCol]: null }, data: { [sentCol]: now } });
        if (count === 0) return false;
        // The day-before reminder is moot once the hour one goes, so it's marked too.
        if (which === "hour") await tx.booking.updateMany({ where: { id: b.id, reminder24SentAt: null }, data: { reminder24SentAt: now } });
        await sendBookingReminder(tx, b.id, which);
        return true;
      });
      if (claimed) sent[which]++;
    }
  }
  return sent;
}
