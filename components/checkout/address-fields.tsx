"use client";

import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type StateOption = { id: number; name: string; lgas: { id: number; name: string }[] };
export const EMPTY_ADDRESS = { recipientName: "", phone: "", line1: "", line2: "", landmark: "", city: "", stateId: "", lgaId: "" };
export type AddressDraft = typeof EMPTY_ADDRESS;

/** Nigerian address fields: street, landmark, town, then state and LGA (the LGA list follows the state). */
export function AddressFields({
  value,
  onChange,
  states,
  errors,
  errorPrefix = "",
}: {
  value: AddressDraft;
  onChange: (next: AddressDraft) => void;
  states: StateOption[];
  errors: Record<string, string | undefined>;
  errorPrefix?: string;
}) {
  const lgas = states.find((s) => s.id === Number(value.stateId))?.lgas ?? [];
  const field = (k: keyof AddressDraft) => ({
    value: value[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value, ...(k === "stateId" ? { lgaId: "" } : {}) }),
  });
  const err = (k: string) => errors[`${errorPrefix}${k}`];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField id="recipientName" label="Recipient's name" error={err("recipientName")}>
        <Input autoComplete="name" {...field("recipientName")} />
      </FormField>
      <FormField id="phone" label="Phone number" hint="For the rider to reach you" error={err("phone")}>
        <Input type="tel" autoComplete="tel" inputMode="tel" {...field("phone")} />
      </FormField>
      <div className="sm:col-span-2">
        <FormField id="line1" label="Street address" error={err("line1")}>
          <Input autoComplete="address-line1" {...field("line1")} />
        </FormField>
      </div>
      <FormField id="line2" label="Flat, floor or building (optional)" error={err("line2")}>
        <Input autoComplete="address-line2" {...field("line2")} />
      </FormField>
      <FormField id="landmark" label="Nearest landmark (optional)" error={err("landmark")}>
        <Input {...field("landmark")} />
      </FormField>
      <FormField id="city" label="Town or city" error={err("city")}>
        <Input autoComplete="address-level2" {...field("city")} />
      </FormField>
      <FormField id="stateId" label="State" error={err("stateId")}>
        <Select {...field("stateId")}>
          <option value="">Choose a state</option>
          {states.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id="lgaId" label="LGA" error={err("lgaId")}>
        <Select {...field("lgaId")} disabled={lgas.length === 0}>
          <option value="">Choose an LGA</option>
          {lgas.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </FormField>
    </div>
  );
}
