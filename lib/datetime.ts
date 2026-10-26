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
