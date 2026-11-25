"use client";

import { LocateFixed } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export type Gps = { lat: number; lng: number };

/** Remembers "near me" for search and the cart, rounded to about 100 m. */
export function rememberNearMe(p: Gps) {
  const v = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
  document.cookie = `tm_near=${v}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax${location.protocol === "https:" ? "; secure" : ""}`;
}

/** Asks the browser for the phone's location (GPS). Nothing is sent until the shopper taps. */
export function requestLocation(): Promise<Gps> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This browser can't share its location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? "Location is blocked for TownMart. Allow it in your browser settings, or carry on without it."
              : "We couldn't find your location. Try again outside or near a window.",
          ),
        ),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

export function UseLocationButton({
  onLocated,
  label = "Use my location",
  variant = "outline",
  size = "sm",
}: {
  onLocated: (p: Gps) => void;
  label?: string;
  variant?: "outline" | "default" | "ghost";
  size?: "sm" | "default";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const p = await requestLocation();
            rememberNearMe(p);
            onLocated(p);
          } catch (e) {
            setError(e instanceof Error ? e.message : "We couldn't find your location.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <LocateFixed aria-hidden /> {busy ? "Finding you…" : label}
      </Button>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** "Show what's nearest": shares the location once (remembered on this device) and sorts by distance. */
export function NearMeButton({ href, known }: { href: string; known: boolean }) {
  if (known)
    return (
      <a href={href} className="inline-flex items-center gap-2 self-start rounded-full border px-4 py-1.5 text-sm hover:bg-muted">
        <LocateFixed className="size-4" aria-hidden /> Nearest first
      </a>
    );
  return <UseLocationButton label="Show what's nearest to me" onLocated={() => window.location.assign(href)} />;
}
