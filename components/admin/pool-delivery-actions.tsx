"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { adminAssignPoolRiderAction, adminOfferToPoolAction } from "@/lib/admin/rider-actions";

/** On the Deliveries board: put an online TownMart rider on a delivery, or text nearby riders again. */
export function PoolDeliveryActions({ sellerOrderId, riders, canOffer }: { sellerOrderId: string; riders: { id: string; label: string }[]; canOffer: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [riderId, setRiderId] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Done.") : (r.error ?? "Something went wrong.") });
      if (r.ok) router.refresh();
    });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {riders.length > 0 ? (
          <>
            <Select aria-label="TownMart rider" className="h-9 w-auto max-w-xs" value={riderId} onChange={(e) => setRiderId(e.target.value)}>
              <option value="">Choose an online TownMart rider…</option>
              {riders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
            <Button type="button" size="sm" disabled={pending || !riderId} onClick={() => run(() => adminAssignPoolRiderAction({ sellerOrderId, riderId }))}>
              Assign
            </Button>
          </>
        ) : (
          <span className="text-xs text-muted-foreground">No TownMart riders online.</span>
        )}
        {canOffer && (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => adminOfferToPoolAction({ sellerOrderId }))}>
            Text nearby riders
          </Button>
        )}
      </div>
      {msg && <p className={msg.ok ? "text-xs text-success" : "text-xs text-danger"}>{msg.text}</p>}
    </div>
  );
}
