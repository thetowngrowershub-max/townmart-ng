"use client";

import { Bike, Store } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { setRiderModeAction } from "@/lib/fulfilment/rider-actions";
import { cn } from "@/lib/utils";

const OPTIONS = [
  {
    mode: "townmart" as const,
    icon: Bike,
    title: "TownMart riders (standard)",
    text: "Vetted TownMart riders collect each paid delivery. You just pack the order. The customer's delivery fee pays the rider.",
  },
  {
    mode: "own" as const,
    icon: Store,
    title: "My own riders",
    text: "You assign one of your riders below to each delivery and keep the delivery fee.",
  },
];

/** Who delivers the shop's orders by default. Either way the other is one tap away on each order. */
export function RiderModePicker({ mode, canManage }: { mode: "townmart" | "own"; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const pick = (m: "townmart" | "own") =>
    start(async () => {
      const r = await setRiderModeAction({ mode: m });
      setMsg({ ok: r.ok, text: r.ok ? (r.message ?? "Saved.") : (r.error ?? "Something went wrong.") });
      if (r.ok) router.refresh();
    });
  return (
    <fieldset className="flex flex-col gap-3" disabled={!canManage || pending}>
      <legend className="mb-2 font-semibold">Who delivers your orders</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((o) => (
          <label key={o.mode} className={cn("flex cursor-pointer gap-3 rounded-xl border p-4 text-sm", mode === o.mode ? "border-primary bg-primary-soft" : "hover:bg-muted")}>
            <input type="radio" name="rider-mode" className="mt-1 accent-primary" checked={mode === o.mode} onChange={() => pick(o.mode)} />
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2 font-medium">
                <o.icon className="size-4" aria-hidden /> {o.title}
              </span>
              <span className="text-muted-foreground">{o.text}</span>
            </span>
          </label>
        ))}
      </div>
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
    </fieldset>
  );
}
