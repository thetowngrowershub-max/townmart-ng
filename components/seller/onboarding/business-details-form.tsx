"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { BUSINESS_TYPES } from "@/lib/catalogue/units";
import { saveBusinessDetailsAction } from "@/lib/seller/actions";
import { SERVICE_AREA_LABEL, type AreaState } from "@/lib/service-area";
import { businessDetailsSchema, type BusinessDetailsInput } from "@/lib/validation/seller";

export type StateOption = AreaState;

const toSlug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function BusinessDetailsForm({
  states,
  initial,
  appHost,
}: {
  states: StateOption[];
  initial: Partial<BusinessDetailsInput> | null;
  appHost: string;
}) {
  const router = useRouter();
  const onlyState = states.length === 1 ? states[0] : undefined;
  const onlyLga = onlyState?.lgas.length === 1 ? onlyState.lgas[0] : undefined;
  const [slugTouched, setSlugTouched] = useState(!!initial?.slug);
  const { form, onSubmit, pending, result } = useActionForm(
    businessDetailsSchema,
    async (values) => {
      const res = await saveBusinessDetailsAction(values);
      if (res.ok) router.push("/sell/onboarding");
      return res;
    },
    {
      type: initial?.type,
      name: initial?.name ?? "",
      slug: initial?.slug ?? "",
      cacNumber: initial?.cacNumber ?? "",
      email: initial?.email ?? "",
      phone: initial?.phone ?? "",
      addressLine: initial?.addressLine ?? "",
      // Only the service area can be chosen; while it's one place, it's filled in.
      city: initial?.city ?? (onlyLga?.towns.length === 1 ? onlyLga.towns[0] : ""),
      stateId: initial?.stateId ?? onlyState?.id ?? ("" as unknown as number),
      lgaId: initial?.lgaId ?? onlyLga?.id ?? ("" as unknown as number),
      sellsProducts: initial?.sellsProducts ?? true,
      sellsServices: initial?.sellsServices ?? false,
    },
  );
  const errors = form.formState.errors;
  const stateId = Number(form.watch("stateId"));
  const type = form.watch("type");
  const lgas = states.find((s) => s.id === stateId)?.lgas ?? [];
  const towns = lgas.find((l) => l.id === Number(form.watch("lgaId")))?.towns ?? [];
  const cacOptional = type === "service_provider" || type === "artisan";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      <FormField id="type" label="Business type" error={errors.type?.message}>
        <Select
          {...form.register("type", {
            onChange: (e) => {
              const sells = BUSINESS_TYPES.find((t) => t.value === e.target.value)?.sells;
              if (sells === "services") {
                form.setValue("sellsServices", true);
                form.setValue("sellsProducts", false);
              } else if (sells === "products") {
                form.setValue("sellsProducts", true);
              }
            },
          })}
          defaultValue={initial?.type ?? ""}
        >
          <option value="" disabled>
            Choose…
          </option>
          {BUSINESS_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="name" label="Business name" error={errors.name?.message}>
          <Input
            autoComplete="organization"
            {...form.register("name", { onChange: (e) => !slugTouched && form.setValue("slug", toSlug(e.target.value)) })}
          />
        </FormField>
        <FormField id="slug" label="Store address" hint={`${appHost}/store/your-address`} error={errors.slug?.message}>
          <Input {...form.register("slug", { onChange: () => setSlugTouched(true) })} />
        </FormField>
      </div>
      <FormField
        id="cacNumber"
        label={cacOptional ? "CAC number (optional)" : "CAC registration number"}
        hint="As shown on your CAC certificate, e.g. RC 1234567 or BN 123456."
        error={errors.cacNumber?.message}
      >
        <Input {...form.register("cacNumber")} />
      </FormField>
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField id="email" label="Business email" error={errors.email?.message}>
          <Input type="email" autoComplete="email" {...form.register("email")} />
        </FormField>
        <FormField id="phone" label="Business phone" hint="We'll text a code to confirm it." error={errors.phone?.message}>
          <Input type="tel" autoComplete="tel" inputMode="tel" {...form.register("phone")} />
        </FormField>
      </div>
      <FormField id="addressLine" label="Street address" hint="Kept private. Shoppers only see your town and state." error={errors.addressLine?.message}>
        <Input autoComplete="street-address" {...form.register("addressLine")} />
      </FormField>
      <Alert variant="info">TownMart is open to businesses in {SERVICE_AREA_LABEL} for now. More areas are coming.</Alert>
      <div className="grid gap-5 sm:grid-cols-3">
        <FormField id="city" label="Town / city" error={errors.city?.message}>
          {towns.length > 0 ? (
            <Select {...form.register("city")}>
              <option value="">Choose…</option>
              {towns.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          ) : (
            <Input autoComplete="address-level2" {...form.register("city")} />
          )}
        </FormField>
        <FormField id="stateId" label="State" error={errors.stateId?.message}>
          <Select {...form.register("stateId", { onChange: () => (form.setValue("lgaId", "" as unknown as number), form.setValue("city", "")) })}>
            <option value="">Choose…</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField id="lgaId" label="LGA" error={errors.lgaId?.message}>
          <Select {...form.register("lgaId", { onChange: () => form.setValue("city", "") })} disabled={lgas.length === 0}>
            <option value="">Choose…</option>
            {lgas.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">What will you sell?</legend>
        <Checkbox id="sellsProducts" label="Products" hint="Groceries, fashion, electronics, farm produce…" {...form.register("sellsProducts")} />
        <Checkbox id="sellsServices" label="Services" hint="Plumbing, tailoring, cleaning, repairs…" {...form.register("sellsServices")} />
        {errors.sellsProducts && <p className="text-xs font-medium text-danger">{errors.sellsProducts.message}</p>}
      </fieldset>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </form>
  );
}
