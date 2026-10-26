"use client";

import { useWatch } from "react-hook-form";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveStoreSettingsAction } from "@/lib/seller/actions";
import { storeSettingsSchema, type StoreSettingsInput } from "@/lib/validation/seller";

export function StorePoliciesForm({ initial }: { initial: StoreSettingsInput }) {
  const { form, onSubmit, pending, result } = useActionForm(storeSettingsSchema, saveStoreSettingsAction, initial);
  const errors = form.formState.errors;
  const offersPickup = useWatch({ control: form.control, name: "offersPickup" });
  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {result && (result.ok ? <Alert variant="success">{result.message}</Alert> : <Alert variant="danger">{result.error}</Alert>)}
      <FormField id="returnWindowDays" label="Returns accepted within (days)" hint="0 means no returns except for faulty or wrong items." error={errors.returnWindowDays?.message}>
        <Input inputMode="numeric" className="max-w-32" {...form.register("returnWindowDays")} />
      </FormField>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">How customers get their orders</legend>
        <Checkbox id="offersDelivery" label="Delivery" {...form.register("offersDelivery")} />
        <Checkbox id="offersPickup" label="Pickup from my shop" {...form.register("offersPickup")} />
        {errors.offersDelivery && <p className="text-xs font-medium text-danger">{errors.offersDelivery.message}</p>}
      </fieldset>
      {offersPickup && (
        <FormField id="pickupAddress" label="Pickup address" hint="Shown to customers only after they order." error={errors.pickupAddress?.message}>
          <Input {...form.register("pickupAddress")} />
        </FormField>
      )}
      <FormField id="deliveryNotes" label="Delivery notes (optional)" hint="e.g. Same-day delivery within Ikeja for orders before 12pm." error={errors.deliveryNotes?.message}>
        <Textarea rows={2} {...form.register("deliveryNotes")} />
      </FormField>
      <Checkbox id="acceptsPayOnDelivery" label="Accept pay on delivery" hint="Takes effect when checkout opens." {...form.register("acceptsPayOnDelivery")} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save policies"}
      </Button>
    </form>
  );
}
