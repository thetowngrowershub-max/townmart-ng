"use client";

import { Bike, ExternalLink, LocateFixed, Package, Power, Store, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { acceptJobAction, dropJobAction, setOnlineAction, updateRiderLocationAction } from "@/lib/riders/actions";
import { cn } from "@/lib/utils";

type Result = { ok: boolean; error?: string; message?: string };

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error ?? "Something went wrong." });
      router.refresh();
    });
  return { pending, msg, run };
}

/** Refreshes the jobs page now and then, so new jobs show without a tap. Skipped while the tab is hidden. */
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}

/**
 * Online or offline, and (while online and this page is open) the rider's
 * position every few minutes, so the nearest rider is texted first.
 */
export function OnlineSwitch({ online }: { online: boolean }) {
  const { pending, msg, run } = useAction();
  const [where, setWhere] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!online || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last.current < 120_000) return;
        last.current = Date.now();
        void updateRiderLocationAction({ lat: pos.coords.latitude, lng: pos.coords.longitude })
          .then((r) => setWhere(r.ok ? "Location on: you're offered jobs near you first." : (r.error ?? null)))
          .catch(() => setWhere("No connection. We'll try again shortly."));
      },
      () => setWhere("Location is off. Allow location for TownMart so you get jobs near you first."),
      { enableHighAccuracy: false, maximumAge: 120_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [online]);

  return (
    <div className={cn("flex flex-col gap-3 rounded-2xl border p-4", online ? "border-primary bg-primary-soft" : "bg-muted/40")}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={cn("size-3 rounded-full", online ? "bg-primary" : "bg-muted-foreground")} aria-hidden />
        <p className="flex-1 font-semibold">{online ? "You're online" : "You're offline"}</p>
        <Button type="button" variant={online ? "outline" : "default"} disabled={pending} onClick={() => run(() => setOnlineAction({ online: !online }))} aria-pressed={online}>
          <Power aria-hidden /> {online ? "Go offline" : "Go online"}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        {online ? "We text you when a job comes up near you. Keep this page open to share your location." : "Go online when you're ready to take deliveries."}
      </p>
      {online && where && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <LocateFixed className="size-3.5" aria-hidden /> {where}
        </p>
      )}
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
    </div>
  );
}

export type OpenJobRow = {
  sellerOrderId: string;
  orderNumber: string;
  shop: string;
  dropOff: string;
  distance: string | null;
  toShop: string | null;
  pay: string;
  payOnDelivery: boolean;
  items: number;
  waiting: string;
};

export function OpenJobList({ jobs }: { jobs: OpenJobRow[] }) {
  const { pending, msg, run } = useAction();
  return (
    <div className="flex flex-col gap-3 text-sm">
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
      {jobs.length === 0 ? (
        <p className="text-muted-foreground">No jobs right now. We&apos;ll text you when one comes up.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((j) => (
            <li key={j.sellerOrderId} className="flex flex-col gap-3 rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <Store className="size-4" aria-hidden /> {j.shop}
                  </p>
                  <p className="text-muted-foreground">To: {j.dropOff}</p>
                </div>
                <p className="text-lg font-bold text-primary">{j.pay}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {j.distance && <Badge variant="secondary">{j.distance} delivery</Badge>}
                {j.toShop && <Badge variant="secondary">{j.toShop} to the shop</Badge>}
                <Badge variant="secondary">
                  <Package className="mr-1 size-3" aria-hidden /> {j.items} item{j.items === 1 ? "" : "s"}
                </Badge>
                {j.payOnDelivery && <Badge variant="warning">Collect cash</Badge>}
              </div>
              <Button type="button" disabled={pending} onClick={() => run(() => acceptJobAction({ sellerOrderId: j.sellerOrderId }))}>
                <Bike aria-hidden /> Take this job
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type MyJobRow = { sellerOrderId: string; orderNumber: string; shop: string; pay: string | null; stage: string; pickedUp: boolean; payOnDelivery: boolean; jobUrl: string | null };

export function MyJobList({ jobs }: { jobs: MyJobRow[] }) {
  const { pending, msg, run } = useAction();
  return (
    <div className="flex flex-col gap-3 text-sm">
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
      {jobs.length === 0 ? (
        <p className="text-muted-foreground">No deliveries in hand.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {jobs.map((j) => (
            <li key={j.sellerOrderId} className="flex flex-col gap-3 rounded-xl border border-primary p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{j.shop}</p>
                  <p className="text-muted-foreground">
                    Order {j.orderNumber} · {j.stage}
                    {j.payOnDelivery && " · collect cash"}
                  </p>
                </div>
                {j.pay && <p className="font-bold text-primary">{j.pay}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {j.jobUrl && (
                  <Button asChild>
                    <a href={j.jobUrl}>
                      <ExternalLink aria-hidden /> Open job
                    </a>
                  </Button>
                )}
                {!j.pickedUp && (
                  <Button type="button" variant="ghost" disabled={pending} onClick={() => run(() => dropJobAction({ sellerOrderId: j.sellerOrderId }))}>
                    <Undo2 aria-hidden /> I can&apos;t do this one
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
