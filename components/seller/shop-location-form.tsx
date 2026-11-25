"use client";

import { MapPin } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UseLocationButton } from "@/components/geo/use-location";
import { Alert } from "@/components/ui/alert";
import { saveShopLocationAction } from "@/lib/fulfilment/rider-actions";

/** Pins the shop on the map from the seller's phone, while they're at the shop. */
export function ShopLocationForm({ current }: { current: { lat: number; lng: number } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-3 text-sm">
      {current ? (
        <p className="flex items-center gap-2">
          <MapPin className="size-4 text-primary" aria-hidden />
          <span>
            Pinned.{" "}
            <a href={`https://www.google.com/maps/search/?api=1&query=${current.lat},${current.lng}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              Check it on the map
            </a>
          </span>
        </p>
      ) : (
        <p className="text-muted-foreground">Not set yet. Until it is, customers pay TownMart&apos;s standard delivery rate for your area.</p>
      )}
      <UseLocationButton
        label={pending ? "Saving…" : current ? "I'm at my shop: update the pin" : "I'm at my shop: use my location"}
        onLocated={(p) =>
          start(async () => {
            const res = await saveShopLocationAction(p);
            setResult({ ok: res.ok, text: res.ok ? (res.message ?? "Saved.") : (res.error ?? "Something went wrong.") });
            if (res.ok) router.refresh();
          })
        }
      />
      {result && <Alert variant={result.ok ? "success" : "danger"}>{result.text}</Alert>}
    </div>
  );
}
