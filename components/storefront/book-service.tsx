"use client";

import { CalendarCheck, Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { SlotPicker } from "@/components/bookings/slot-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  const [reload, setReload] = useState(0);
  const [time, setTime] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

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

      <SlotPicker serviceId={serviceId} packageId={packageId} value={time} onChange={setTime} reload={reload} />

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
