"use server";

import { formatTime } from "@/lib/datetime";
import { withSystemContext } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { getCheckoutSettings } from "@/lib/settings";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { slotsQuerySchema } from "@/lib/validation/cart";
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
      where: { id: parsed.data.serviceId, status: "active", deletedAt: null, business: { status: "approved" } },
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
