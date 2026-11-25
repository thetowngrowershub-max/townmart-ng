/**
 * Bookable times for a service. Pure: the caller loads the weekly hours,
 * blackouts and active bookings. Times are worked out in Lagos wall-clock time
 * (UTC+1 all year) and returned as UTC instants.
 *
 * The database has the last word: the exclusion constraint on `bookings`
 * rejects a booking that would take a time beyond its capacity, whatever this
 * function said.
 */

export type WeeklyWindow = {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  bufferMinutes: number;
  maxPerSlot: number;
};

export type Interval = { startsAt: Date; endsAt: Date };

export type Slot = Interval & { capacity: number; remaining: number };

const LAGOS_OFFSET_MS = 3_600_000;
const DAY_MS = 86_400_000;
const MIN_MS = 60_000;

/** Midnight in Lagos for the Lagos calendar day containing `d`, as a UTC instant. */
export function lagosMidnight(d: Date): Date {
  const local = d.getTime() + LAGOS_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - LAGOS_OFFSET_MS);
}

/** The Lagos weekday (0 = Sunday) of an instant. */
export function lagosWeekday(d: Date): number {
  return new Date(d.getTime() + LAGOS_OFFSET_MS).getUTCDay();
}

const overlaps = (a: Interval, b: Interval) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/**
 * Start times on the weekly grid between `from` and `to`, each long enough
 * for `durationMinutes` to finish inside its window, with how many places are
 * left. Times in a blackout, or earlier than `earliest`, are left out; full
 * times are kept with `remaining: 0` unless `onlyOpen` is set.
 */
export function generateSlots(params: {
  windows: readonly WeeklyWindow[];
  blackouts: readonly Interval[];
  /** Active bookings of this service (held, requested, confirmed, in progress). */
  booked: readonly Interval[];
  durationMinutes: number;
  from: Date;
  to: Date;
  earliest: Date;
  onlyOpen?: boolean;
}): Slot[] {
  const out: Slot[] = [];
  const duration = params.durationMinutes * MIN_MS;
  for (let day = lagosMidnight(params.from); day < params.to; day = new Date(day.getTime() + DAY_MS)) {
    const weekday = lagosWeekday(day);
    for (const w of params.windows) {
      if (w.weekday !== weekday || w.slotMinutes <= 0) continue;
      const step = (w.slotMinutes + Math.max(0, w.bufferMinutes)) * MIN_MS;
      const windowEnd = day.getTime() + w.endMinute * MIN_MS;
      for (let t = day.getTime() + w.startMinute * MIN_MS; t + duration <= windowEnd; t += step) {
        const slot = { startsAt: new Date(t), endsAt: new Date(t + duration) };
        if (slot.startsAt < params.earliest || slot.startsAt < params.from || slot.startsAt >= params.to) continue;
        if (params.blackouts.some((b) => overlaps(b, slot))) continue;
        const taken = params.booked.filter((b) => overlaps(b, slot)).length;
        const remaining = Math.max(0, w.maxPerSlot - taken);
        if (params.onlyOpen && remaining === 0) continue;
        out.push({ ...slot, capacity: w.maxPerSlot, remaining });
      }
    }
  }
  return out.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The slot starting exactly at `startsAt`, if the grid has one (used to validate a chosen time). */
export function findSlot(params: Omit<Parameters<typeof generateSlots>[0], "from" | "to" | "onlyOpen">, startsAt: Date): Slot | null {
  const from = startsAt;
  const to = new Date(startsAt.getTime() + 1);
  return generateSlots({ ...params, from, to }).find((s) => s.startsAt.getTime() === startsAt.getTime()) ?? null;
}
