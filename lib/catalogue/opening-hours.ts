/**
 * Opening hours for stores that cook to order (restaurants, QSRs, bakeries).
 *
 * Stored on StorePolicy.openingHours as seven entries, Sunday first: null when
 * closed that day, or { open, close } in minutes after midnight, Lagos time.
 * A store with no hours set takes orders at any time, as before.
 */
import { WEEKDAYS } from "./units";

export type DayHours = { open: number; close: number } | null;
export type WeekHours = DayHours[];

/** Lagos is always UTC+01:00 (no daylight saving). */
const LAGOS_OFFSET_MS = 3600_000;

/** Reads the stored JSON, ignoring anything malformed (treated as "no hours set"). */
export function parseOpeningHours(value: unknown): WeekHours | null {
  if (!Array.isArray(value) || value.length !== 7) return null;
  const week: WeekHours = [];
  for (const d of value) {
    if (d === null) {
      week.push(null);
      continue;
    }
    if (typeof d !== "object" || typeof d.open !== "number" || typeof d.close !== "number") return null;
    if (d.open < 0 || d.close > 1440 || d.close <= d.open) return null;
    week.push({ open: d.open, close: d.close });
  }
  return week;
}

/** "8:00 am", "12:30 pm", "midnight". */
export function formatClock(minutes: number): string {
  if (minutes === 1440 || minutes === 0) return minutes === 0 ? "12:00 am" : "midnight";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Weekday (0 = Sunday) and minutes after midnight, in Lagos time. */
export function lagosClock(now: Date): { day: number; minutes: number } {
  const local = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return { day: local.getUTCDay(), minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

export type OpenState = {
  /** Taking orders right now. */
  open: boolean;
  /** Why not: the seller paused orders, or it's outside their hours. */
  reason: "paused" | "closed" | null;
  /** Short status for listings: "Open now · closes 10:00 pm", "Closed · opens 8:00 am tomorrow". */
  label: string;
};

/**
 * Whether a store is taking orders at `now`. Stores without hours are always
 * open unless they have paused orders.
 */
export function openState(hours: WeekHours | null, paused: boolean, now: Date = new Date()): OpenState {
  if (paused) return { open: false, reason: "paused", label: "Not taking orders right now" };
  if (!hours) return { open: true, reason: null, label: "Open" };
  const { day, minutes } = lagosClock(now);
  const today = hours[day];
  if (today && minutes >= today.open && minutes < today.close) {
    return { open: true, reason: null, label: `Open now · closes ${formatClock(today.close)}` };
  }
  return { open: false, reason: "closed", label: `Closed · ${nextOpening(hours, day, minutes)}` };
}

function nextOpening(hours: WeekHours, day: number, minutes: number): string {
  const today = hours[day];
  if (today && minutes < today.open) return `opens ${formatClock(today.open)} today`;
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const h = hours[d];
    if (!h) continue;
    const when = i === 1 ? "tomorrow" : WEEKDAYS[d];
    return `opens ${formatClock(h.open)} ${when}`;
  }
  return "no opening hours set";
}

/** One line per day for a store page: [["Monday", "8:00 am – 10:00 pm"], ...], Monday first. */
export function describeWeek(hours: WeekHours): [string, string][] {
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((d) => {
    const h = hours[d];
    return [WEEKDAYS[d] ?? "", h ? `${formatClock(h.open)} – ${formatClock(h.close)}` : "Closed"];
  });
}

/** "Ready in about 25 min", "Ready in about 1 hr 30 min". */
export function prepTimeLabel(minutes: number): string {
  if (minutes < 60) return `Ready in about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `Ready in about ${h} hr${h > 1 ? "s" : ""}${m ? ` ${m} min` : ""}`;
}
