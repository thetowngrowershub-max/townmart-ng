"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { serviceSlotsAction, type SlotDay } from "@/lib/bookings/actions";

/**
 * A week of free times for a service: pick a day, then a time (Lagos time).
 * `value` is the chosen start as an ISO instant. Bump `reload` to fetch the
 * times again (after a time was just taken).
 */
export function SlotPicker({ serviceId, packageId, value, onChange, reload = 0 }: { serviceId: string; packageId: string | null; value: string | null; onChange: (startsAt: string | null) => void; reload?: number }) {
  const ids = useId();
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [week, setWeek] = useState<{ days: SlotDay[]; prev: string | null; next: string | null } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const time = value;
  const setTime = onChange;

  useEffect(() => {
    startLoading(async () => {
      const res = await serviceSlotsAction({ serviceId, packageId, from }).catch(() => null);
      if (!res || !res.ok || !res.data) {
        setLoadError(res && !res.ok ? res.error : "We couldn't load the times. Please try again.");
        return;
      }
      const data = res.data;
      setLoadError(null);
      setWeek(data);
      setDay((d) => (d && data.days.some((x) => x.date === d && x.times.length) ? d : (data.days.find((x) => x.times.length)?.date ?? null)));
      onChange(null);
    });
    // onChange is the parent's setter; re-fetch only when what's being booked changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId, packageId, from, reload]);

  const selected = week?.days.find((d) => d.date === day) ?? null;

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" id={`${ids}-day`}>
            Day
          </p>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="icon" aria-label="Earlier days" disabled={!week?.prev || loading} onClick={() => setFrom(week?.prev ?? undefined)}>
              <ChevronLeft aria-hidden />
            </Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Later days" disabled={!week?.next || loading} onClick={() => setFrom(week?.next ?? undefined)}>
              <ChevronRight aria-hidden />
            </Button>
          </div>
        </div>
        {loadError && <Alert variant="danger">{loadError}</Alert>}
        <div role="radiogroup" aria-labelledby={`${ids}-day`} className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7" aria-busy={loading}>
          {(week?.days ?? []).map((d) => {
            const open = d.times.length > 0;
            const active = d.date === day;
            return (
              <button
                key={d.date}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!open}
                onClick={() => {
                  setDay(d.date);
                  setTime(null);
                }}
                className={`rounded-xl border px-1 py-2 text-center text-xs leading-tight transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}
              >
                {d.label.split(" ").map((part, i) => (
                  <span key={i} className={i === 1 ? "block text-base font-bold" : "block"}>
                    {part.replace(",", "")}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
        {week && week.days.every((d) => d.times.length === 0) && !loading && <p className="text-sm text-muted-foreground">No free times this week. Try later days.</p>}
      </div>

      {selected && selected.times.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold" id={`${ids}-time`}>
            Time <span className="font-normal text-muted-foreground">(Lagos time)</span>
          </p>
          <div role="radiogroup" aria-labelledby={`${ids}-time`} className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {selected.times.map((t) => (
              <button
                key={t.startsAt}
                type="button"
                role="radio"
                aria-checked={time === t.startsAt}
                onClick={() => setTime(t.startsAt)}
                className={`rounded-xl border py-2 text-sm font-medium tabular-nums transition-colors ${time === t.startsAt ? "border-primary bg-primary text-primary-foreground" : "hover:border-primary"}`}
              >
                {t.label}
                {t.remaining > 1 && <span className="block text-[11px] font-normal opacity-80">{t.remaining} places</span>}
              </button>
            ))}
          </div>
        </div>
      )}

    </>
  );
}
