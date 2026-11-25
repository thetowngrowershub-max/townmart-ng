export const TIME_ZONE = "Africa/Lagos";
export const LOCALE = "en-NG";

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

const dateFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, dateStyle: "medium" });

/** Timestamps are stored as UTC timestamptz and always displayed in Lagos time. */
export function formatDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

export function formatDate(date: Date): string {
  return dateFormatter.format(date);
}

const bookingFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const timeFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });

/** A booking time, with the weekday: "Sat, 1 Nov 2026, 9:30 am". */
export function formatBookingTime(date: Date): string {
  return bookingFormatter.format(date);
}

/** Just the clock time: "9:30 am". */
export function formatTime(date: Date): string {
  return timeFormatter.format(date);
}

/** Lagos has no daylight saving: it is always UTC+01:00. */
export const LAGOS_OFFSET = "+01:00";

/** Reads a `datetime-local` value ("2026-11-01T09:30") as Lagos wall-clock time. */
export function lagosLocalToDate(local: string): Date {
  return new Date(`${local.length === 16 ? `${local}:00` : local}${LAGOS_OFFSET}`);
}

/** The inverse: a Date as a `datetime-local` value in Lagos time. */
export function dateToLagosLocal(date: Date): string {
  return new Date(date.getTime() + 3600_000).toISOString().slice(0, 16);
}

const dayFormatter = new Intl.DateTimeFormat(LOCALE, { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" });

/** "Tuesday 27 October": a day heading in Lagos time. */
export function formatDay(date: Date): string {
  return dayFormatter.format(date);
}
