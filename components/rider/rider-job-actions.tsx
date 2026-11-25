"use client";

import { CheckCircle2, LocateFixed, PackageCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { riderDeliveredAction, riderLocationAction, riderPickedUpAction } from "@/lib/fulfilment/rider-job-actions";

/**
 * The rider's two buttons: "Picked up" at the shop, then "Delivered" with the
 * customer's code. Works on a slow connection: one tap, one small request.
 */
export function RiderJobActions({ token, pickedUp, delivered }: { token: string; pickedUp: boolean; delivered: boolean }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[] | undefined> }>) =>
    start(async () => {
      try {
        const res = await fn();
        setMsg(res.ok ? { ok: true, text: res.message ?? "Done." } : { ok: false, text: res.fieldErrors?.code?.[0] ?? res.error ?? "Please try again." });
        if (res.ok) router.refresh();
      } catch {
        setMsg({ ok: false, text: "No connection. Check your network and tap again." });
      }
    });

  if (delivered) {
    return (
      <Alert variant="success">
        <CheckCircle2 aria-hidden /> Delivered. Thank you!
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!pickedUp ? (
        <Button size="lg" className="h-14 text-base" disabled={pending} onClick={() => run(() => riderPickedUpAction({ token }))}>
          <PackageCheck aria-hidden /> {pending ? "Saving…" : "I've picked up the items"}
        </Button>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => riderDeliveredAction({ token, code }));
          }}
        >
          <Label htmlFor="code">Customer&apos;s 4-digit code</Label>
          <Input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{4}"
            maxLength={4}
            className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
          />
          <Button type="submit" size="lg" className="h-14 text-base" disabled={pending || code.length !== 4}>
            <CheckCircle2 aria-hidden /> {pending ? "Checking…" : "Delivered"}
          </Button>
          <p className="text-xs text-muted-foreground">The customer got the code by text. Ask for it only after you&apos;ve handed over the items.</p>
        </form>
      )}
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
      <ShareLocation token={token} />
    </div>
  );
}

/**
 * Shares the rider's position every minute or so while the page is open, so
 * the shop and TownMart can see where the delivery is. Off until the rider
 * taps it; nothing runs in the background once the page is closed.
 */
function ShareLocation({ token }: { token: string }) {
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const last = useRef(0);

  useEffect(() => {
    if (!on || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        if (Date.now() - last.current < 60_000) return;
        last.current = Date.now();
        void riderLocationAction({ token, lat: pos.coords.latitude, lng: pos.coords.longitude })
          .then((r) => setNote(r.ok ? `Location shared at ${new Date().toLocaleTimeString("en-NG", { hour: "numeric", minute: "2-digit" })}` : (r.error ?? null)))
          .catch(() => setNote("No connection. We'll try again in a minute."));
      },
      () => {
        setOn(false);
        setNote("Location is off. Allow location for this site to share it.");
      },
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 30_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [on, token]);

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="outline" onClick={() => setOn((v) => !v)} aria-pressed={on}>
        <LocateFixed aria-hidden /> {on ? "Sharing my location (tap to stop)" : "Share my location with the shop"}
      </Button>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
