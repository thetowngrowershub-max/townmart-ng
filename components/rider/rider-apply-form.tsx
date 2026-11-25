"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { RIDER_VEHICLES, VEHICLE_LABELS, type RiderVehicle } from "@/lib/fulfilment/rider-vehicles";
import { applyAsRiderAction } from "@/lib/riders/actions";

type Draft = { name: string; phone: string; vehicle: RiderVehicle; plateNumber: string; homeTown: string; nin: string; guarantorName: string; guarantorPhone: string };

/** Applying to ride for TownMart (or updating a pending or rejected application). */
export function RiderApplyForm({ initial, towns, resubmit }: { initial: Draft; towns: string[]; resubmit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [d, setD] = useState<Draft>(initial);
  const [agree, setAgree] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof Draft) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const needsPlate = d.vehicle === "motorbike" || d.vehicle === "tricycle" || d.vehicle === "car";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const r = await applyAsRiderAction({ ...d, agree: agree as true });
      const fe: Record<string, string> = {};
      const fieldErrors = (!r.ok && r.fieldErrors) || {};
      for (const [k, v] of Object.entries(fieldErrors)) fe[k] = v?.[0] ?? "";
      setErrors(fe);
      setMsg(r.ok ? { ok: true, text: r.message ?? "Sent." } : { ok: false, text: r.error ?? "Please check the form." });
      if (r.ok) router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField id="ra-name" label="Full name (as on your ID)" error={errors.name}>
          <Input value={d.name} maxLength={80} autoComplete="name" onChange={set("name")} />
        </FormField>
        <FormField id="ra-phone" label="Your phone" hint="Jobs are texted here." error={errors.phone}>
          <Input type="tel" inputMode="tel" autoComplete="tel" value={d.phone} onChange={set("phone")} />
        </FormField>
        <FormField id="ra-vehicle" label="You deliver by" error={errors.vehicle}>
          <Select value={d.vehicle} onChange={set("vehicle")}>
            {RIDER_VEHICLES.map((v) => (
              <option key={v} value={v}>
                {VEHICLE_LABELS[v]}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="ra-plate" label={needsPlate ? "Plate number" : "Plate number (if any)"} error={errors.plateNumber}>
          <Input value={d.plateNumber} maxLength={20} autoCapitalize="characters" onChange={set("plateNumber")} />
        </FormField>
        <FormField id="ra-town" label="Where you're based" error={errors.homeTown}>
          <Select value={d.homeTown} onChange={set("homeTown")}>
            {towns.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="ra-nin" label="NIN (optional, speeds up approval)" hint="Your 11-digit National Identification Number." error={errors.nin}>
          <Input inputMode="numeric" maxLength={14} autoComplete="off" value={d.nin} onChange={set("nin")} />
        </FormField>
        <FormField id="ra-g-name" label="Guarantor's name" hint="Someone who knows you well, not a family member who lives with you." error={errors.guarantorName}>
          <Input value={d.guarantorName} maxLength={80} onChange={set("guarantorName")} />
        </FormField>
        <FormField id="ra-g-phone" label="Guarantor's phone" hint="TownMart will call them." error={errors.guarantorPhone}>
          <Input type="tel" inputMode="tel" autoComplete="off" value={d.guarantorPhone} onChange={set("guarantorPhone")} />
        </FormField>
      </div>
      <Checkbox
        id="ra-agree"
        checked={agree}
        onChange={(e) => setAgree(e.target.checked)}
        label={
          <>
            I&apos;ll handle customers&apos; orders with care, hand them over only with the customer&apos;s delivery code, and follow the{" "}
            <Link href="/legal/terms" className="text-primary underline">
              Terms of Use
            </Link>
            .
          </>
        }
      />
      {errors.agree && <p className="text-xs font-medium text-danger">{errors.agree}</p>}
      {msg && <Alert variant={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
      <Button type="submit" disabled={pending} className="self-start">
        {resubmit ? "Update my application" : "Send my application"}
      </Button>
    </form>
  );
}
