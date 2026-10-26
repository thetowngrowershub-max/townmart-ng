"use client";

import { Ban, Banknote, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { advanceOrderAction, cancelSellerOrderAction, markCashCollectedAction } from "@/lib/fulfilment/actions";
import type { SellerOrderDetail } from "@/lib/fulfilment/seller-view";

/** The seller's next step on an order, plus cash collected and cancel for pay on delivery. */
export function SellerOrderActions({ order }: { order: Pick<SellerOrderDetail, "id" | "steps" | "canCancel" | "canMarkCash"> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState({ number: "", carrier: "" });
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const run = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setError(null);
        setCancelling(false);
        router.refresh();
      } else setError(Object.values(res.fieldErrors ?? {})[0]?.[0] ?? res.error ?? "Something went wrong.");
    });

  if (!order.steps.length && !order.canCancel && !order.canMarkCash) return null;
  return (
    <div className="flex flex-col gap-3">
      {order.steps.map((s) =>
        s.to === "shipped" ? (
          <form
            key={s.to}
            className="flex flex-col gap-3 rounded-xl border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => advanceOrderAction({ id: order.id, to: s.to, trackingNumber: tracking.number, carrier: tracking.carrier }));
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="carrier">Courier (optional)</Label>
                <Input id="carrier" placeholder="e.g. GIG Logistics, own rider" value={tracking.carrier} maxLength={60} onChange={(e) => setTracking((t) => ({ ...t, carrier: e.target.value }))} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tracking">Tracking number (optional)</Label>
                <Input id="tracking" value={tracking.number} maxLength={60} onChange={(e) => setTracking((t) => ({ ...t, number: e.target.value }))} />
              </div>
            </div>
            <Button type="submit" disabled={pending}>
              <Truck aria-hidden /> {s.label}
            </Button>
          </form>
        ) : (
          <Button key={s.to} type="button" disabled={pending} onClick={() => run(() => advanceOrderAction({ id: order.id, to: s.to }))}>
            {s.label}
          </Button>
        ),
      )}
      {order.canMarkCash && (
        <Button type="button" variant="outline" disabled={pending} onClick={() => run(() => markCashCollectedAction({ id: order.id }))}>
          <Banknote aria-hidden /> I&apos;ve been paid
        </Button>
      )}
      {order.canCancel &&
        (cancelling ? (
          <form
            className="flex flex-col gap-2 rounded-xl border border-danger/40 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => cancelSellerOrderAction({ id: order.id, reason }));
            }}
          >
            <Label htmlFor="cancel-reason">Why are you cancelling?</Label>
            <Input id="cancel-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Out of stock after all" />
            <p className="text-xs text-muted-foreground">The customer is told, and the items go back on sale.</p>
            <div className="flex gap-2">
              <Button type="submit" variant="danger" size="sm" disabled={pending}>
                Cancel order
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setCancelling(false)}>
                Keep it
              </Button>
            </div>
          </form>
        ) : (
          <Button type="button" variant="ghost" className="text-danger" onClick={() => setCancelling(true)}>
            <Ban aria-hidden /> Cancel this order
          </Button>
        ))}
      <div aria-live="polite">{error && <Alert variant="danger">{error}</Alert>}</div>
    </div>
  );
}
