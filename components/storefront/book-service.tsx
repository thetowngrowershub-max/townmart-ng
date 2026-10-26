"use client";

import { CalendarCheck, Check, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { serviceSlotsAction, type SlotDay } from "@/lib/bookings/actions";
import { addBookingToCartAction } from "@/lib/cart/actions";

type Package = { id: string; name: string; price: string; duration: string };

/**
 * Pick a package (if any), a day and a time, then add the booking to the
 * cart. Times come from the provider's weekly hours, less blackouts and
 * other bookings; the time is claimed when the order is placed.
 */
export function BookService({ serviceId, locationMode, packages, requiresPackage }: { serviceId: string; locationMode: "on_site" | "at_provider" | "both"; packages: Package[]; requiresPackage: boolean }) {
  const router = useRouter();
  const [packageId, setPackageId] = useState<string | null>(requiresPackage ? (packages[0]?.id ?? null) : null);
  const [atProvider, setAtProvider] = useState(locationMode === "at_provider");
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [reload, setReload] = useState(0);
  const [week, setWeek] = useState<{ days: SlotDay[]; prev: string | null; next: string | null } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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
      setTime(null);
    });
  }, [serviceId, packageId, from, reload]);

  const selected = week?.days.find((d) => d.date === day) ?? null;

  const book = () =>
    start(async () => {
      if (!time) return;
      const res = await addBookingToCartAction({ serviceId, packageId, startsAt: time, atProvider }).catch(() => ({ ok: false as const, error: "Something went wrong. Please try again.", fieldErrors: undefined }));
      setResult(res.ok ? { ok: true, message: res.message ?? "Booking added to your cart." } : { ok: false, message: res.fieldErrors?.startsAt?.[0] ?? res.error });
      if (res.ok) router.refresh();
      // A time that was just taken drops off the list.
      else setReload((n) => n + 1);
    });

  return (
    <div className="flex flex-col gap-4">
      {packages.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Package</legend>
          {!requiresPackage && (
            <label className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input type="radio" name="package" checked={packageId === null} onChange={() => setPackageId(null)} className="size-4 accent-primary" />
              <span className="flex-1">Standard service</span>
            </label>
          )}
          {packages.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
              <input type="radio" name="package" checked={packageId === p.id} onChange={() => setPackageId(p.id)} className="size-4 accent-primary" />
              <span className="flex-1">
                <span className="font-medium">{p.name}</span>
                <span className="block text-xs text-muted-foreground">About {p.duration}</span>
              </span>
              <span className="font-semibold tabular-nums">{p.price}</span>
            </label>
          ))}
        </fieldset>
      )}

      {locationMode === "both" && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold">Where</legend>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: false, label: "At my address" },
              { value: true, label: "At the provider's place" },
            ].map((o) => (
              <label key={o.label} className="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input type="radio" name="where" checked={atProvider === o.value} onChange={() => setAtProvider(o.value)} className="size-4 accent-primary" />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" id="day-label">
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
        <div role="radiogroup" aria-labelledby="day-label" className="grid grid-cols-4 gap-2 sm:grid-cols-7 lg:grid-cols-4 xl:grid-cols-7" aria-busy={loading}>
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
          <p className="text-sm font-semibold" id="time-label">
            Time <span className="font-normal text-muted-foreground">(Lagos time)</span>
          </p>
          <div role="radiogroup" aria-labelledby="time-label" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
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

      <Button type="button" size="lg" disabled={!time || pending || (requiresPackage && !packageId)} onClick={book}>
        <CalendarCheck aria-hidden /> {pending ? "Adding…" : "Book now"}
      </Button>
      <div aria-live="polite">
        {result?.ok && (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <Check className="size-4" aria-hidden /> {result.message}{" "}
            <Link href="/checkout" className="text-primary underline">
              Check out
            </Link>
          </p>
        )}
        {result && !result.ok && <Alert variant="danger">{result.message}</Alert>}
      </div>
    </div>
  );
}
