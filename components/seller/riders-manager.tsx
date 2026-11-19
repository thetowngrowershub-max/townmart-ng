"use client";

import { Bike, Pencil, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RIDER_VEHICLES, VEHICLE_LABELS, type RiderVehicle } from "@/lib/fulfilment/rider-vehicles";
import { removeRiderAction, saveRiderAction, setRiderAvailableAction } from "@/lib/fulfilment/rider-actions";

export type RiderRow = { id: string; name: string; phone: string; vehicle: RiderVehicle; isAvailable: boolean; activeJobs: number };

type Draft = { id?: string; name: string; phone: string; vehicle: RiderVehicle; isAvailable: boolean };
const EMPTY: Draft = { name: "", phone: "", vehicle: "motorbike", isAvailable: true };

/** The shop's riders: add, edit, switch on or off duty, remove. */
export function RidersManager({ riders }: { riders: RiderRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(riders.length === 0 ? EMPTY : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> }>, after?: () => void) =>
    start(async () => {
      const res = await fn();
      const fe: Record<string, string> = {};
      for (const [k, v] of Object.entries(res.fieldErrors ?? {})) fe[k] = v[0] ?? "";
      setErrors(fe);
      setMessage(res.ok ? (res.message ? { ok: true, text: res.message } : null) : { ok: false, text: res.error ?? "Something went wrong." });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-4">
      {message && <Alert variant={message.ok ? "success" : "danger"}>{message.text}</Alert>}
      {riders.length > 0 && (
        <ul className="divide-y rounded-xl border">
          {riders.map((r) => (
            <li key={r.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-start gap-3">
                <Bike className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="text-sm">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {r.isAvailable ? <Badge variant="success">On duty</Badge> : <Badge variant="secondary">Off duty</Badge>}
                    {r.activeJobs > 0 && <Badge variant="info">{r.activeJobs} in hand</Badge>}
                  </p>
                  <p className="text-muted-foreground">
                    {VEHICLE_LABELS[r.vehicle]} ·{" "}
                    <a href={`tel:${r.phone}`} className="underline">
                      {r.phone}
                    </a>
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => setRiderAvailableAction({ id: r.id, isAvailable: !r.isAvailable }))}>
                  {r.isAvailable ? "Set off duty" : "Set on duty"}
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDraft({ id: r.id, name: r.name, phone: r.phone, vehicle: r.vehicle, isAvailable: r.isAvailable })}>
                  <Pencil aria-hidden /> Edit
                </Button>
                <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeRiderAction({ id: r.id }))}>
                  <Trash2 aria-hidden /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {draft ? (
        <form
          noValidate
          className="flex flex-col gap-4 rounded-xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveRiderAction(draft), () => setDraft(null));
          }}
        >
          <p className="font-medium">{draft.id ? "Edit rider" : "Add a rider"}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="rider-name" label="Name" error={errors.name}>
              <Input value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </FormField>
            <FormField id="rider-phone" label="Phone" hint="Order details are sent here." error={errors.phone}>
              <Input type="tel" inputMode="tel" autoComplete="off" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            </FormField>
            <FormField id="rider-vehicle" label="Gets around by" error={errors.vehicle}>
              <Select value={draft.vehicle} onChange={(e) => setDraft({ ...draft, vehicle: e.target.value as RiderVehicle })}>
                {RIDER_VEHICLES.map((v) => (
                  <option key={v} value={v}>
                    {VEHICLE_LABELS[v]}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <Checkbox id="rider-available" label="On duty now" hint="Only riders on duty are suggested for new deliveries." checked={draft.isAvailable} onChange={(e) => setDraft({ ...draft, isAvailable: e.target.checked })} />
          <div className="flex gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : draft.id ? "Save rider" : "Add rider"}
            </Button>
            {riders.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button type="button" variant="outline" className="self-start" onClick={() => setDraft(EMPTY)}>
          <Plus aria-hidden /> Add a rider
        </Button>
      )}
    </div>
  );
}
