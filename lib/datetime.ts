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
