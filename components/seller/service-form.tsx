"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFieldArray, useWatch } from "react-hook-form";
import { useActionForm } from "@/components/auth/use-action-form";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { ImageGalleryInput, type GalleryImage } from "@/components/uploads/image-gallery-input";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveServiceAction } from "@/lib/catalogue/actions";
import { WEEKDAYS } from "@/lib/catalogue/units";
import { serviceInputSchema, type ServiceInput } from "@/lib/validation/catalogue";
import type { CategoryOption } from "./product-form";

export type ServiceFormValues = Omit<ServiceInput, "images"> & { images: GalleryImage[] };
export type LgaGroup = { stateId: number; stateName: string; lgas: { id: number; name: string }[] };

const PRICE_LABEL: Record<ServiceInput["pricingModel"], string> = {
  fixed: "Price (₦)",
  from: "Starting from (₦)",
  hourly: "Price per hour (₦)",
  packages: "Packages set the price",
};
const PACKAGE_NAMES = ["Basic", "Standard", "Premium"];
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);

export function ServiceForm({
  serviceId,
  categories,
  lgaGroups,
  defaultStateId,
  initial,
}: {
  serviceId: string | null;
  categories: CategoryOption[];
  lgaGroups: LgaGroup[];
  defaultStateId: number;
  initial: ServiceFormValues;
}) {
  const router = useRouter();
  const { form, onSubmit, pending, result } = useActionForm(
    serviceInputSchema,
    async (values) => {
      const res = await saveServiceAction(serviceId, values);
      if (res.ok && res.data) {
        if (!serviceId) router.push(`/dashboard/services/${res.data.id}?saved=1`);
        else router.refresh();
      }
      return res;
    },
    initial as ServiceInput,
  );
  const errors = form.formState.errors;
  const packages = useFieldArray({ control: form.control, name: "packages" });
  const availability = useFieldArray({ control: form.control, name: "availability" });
  const blackouts = useFieldArray({ control: form.control, name: "blackouts" });
  const [pricingModel, locationMode, images, lgaIds] = useWatch({ control: form.control, name: ["pricingModel", "locationMode", "images", "serviceLgaIds"] }) as [
    ServiceInput["pricingModel"],
    ServiceInput["locationMode"],
    GalleryImage[],
    number[],
  ];
  const [lgaState, setLgaState] = useState(defaultStateId);
  const selected = new Set((lgaIds ?? []).map(Number));
  const toggleLga = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    form.setValue("serviceLgaIds", [...next], { shouldDirty: true, shouldValidate: form.formState.isSubmitted });
  };
  const visibleLgas = lgaGroups.find((g) => g.stateId === lgaState)?.lgas ?? [];
  const lgaName = new Map(lgaGroups.flatMap((g) => g.lgas.map((l) => [l.id, `${l.name} (${g.stateName})`] as const)));

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6 pb-24">
      {result && !result.ok && <Alert variant="danger">{result.error}</Alert>}
      {result?.ok && <Alert variant="success">{result.message}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="title" label="Title" error={errors.title?.message}>
            <Input {...form.register("title")} placeholder="e.g. Leaking pipe and tap repair" />
          </FormField>
          <div className="flex flex-col gap-2">
            <label htmlFor="descriptionHtml" className="text-sm font-medium">
              Description
            </label>
            <RichTextEditor id="descriptionHtml" value={form.getValues("descriptionHtml") ?? ""} onChange={(html) => form.setValue("descriptionHtml", html, { shouldDirty: true })} />
          </div>
          <FormField id="categoryId" label="Category" error={errors.categoryId?.message}>
            <Select {...form.register("categoryId")}>
              <option value="">Choose…</option>
              {categories.map((c) =>
                c.children.length ? (
                  <optgroup key={c.id} label={c.name}>
                    {c.children.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ) : (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ),
              )}
            </Select>
          </FormField>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Portfolio images</CardTitle>
          <CardDescription>Photos of your past work. The first image is the cover.</CardDescription>
        </CardHeader>
        <CardContent>
          <ImageGalleryInput
            purpose="service"
            withCover={false}
            value={images ?? []}
            onChange={(next) => form.setValue("images", next as never, { shouldDirty: true })}
            error={errors.images?.message ?? (Array.isArray(errors.images) ? "Every image needs alt text (at least 3 characters)." : undefined)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-3">
            <FormField id="pricingModel" label="Pricing" error={errors.pricingModel?.message}>
              <Select
                {...form.register("pricingModel", {
                  onChange: (e) => {
                    if (e.target.value === "packages" && packages.fields.length === 0) {
                      packages.append({ name: "Basic", description: "", price: form.getValues("basePrice") || "", durationMinutes: Number(form.getValues("durationMinutes")) || 60 });
                    }
                  },
                })}
              >
                <option value="fixed">Fixed price</option>
                <option value="from">Starting from</option>
                <option value="hourly">Hourly</option>
                <option value="packages">Packages (Basic / Standard / Premium)</option>
              </Select>
            </FormField>
            {pricingModel !== "packages" && (
              <FormField id="basePrice" label={PRICE_LABEL[pricingModel]} error={errors.basePrice?.message}>
                <Input inputMode="decimal" {...form.register("basePrice")} />
              </FormField>
            )}
            <FormField id="durationMinutes" label="Typical duration (minutes)" error={errors.durationMinutes?.message}>
              <Input inputMode="numeric" {...form.register("durationMinutes")} />
            </FormField>
          </div>
          {pricingModel === "packages" && (
            <div className="flex flex-col gap-4">
              {packages.fields.map((field, i) => (
                <fieldset key={field.id} className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-[1fr_140px_140px_auto]">
                  <legend className="sr-only">Package {i + 1}</legend>
                  <FormField id={`packages.${i}.name`} label="Name" error={errors.packages?.[i]?.name?.message}>
                    <Input {...form.register(`packages.${i}.name`)} />
                  </FormField>
                  <FormField id={`packages.${i}.price`} label="Price (₦)" error={errors.packages?.[i]?.price?.message}>
                    <Input inputMode="decimal" {...form.register(`packages.${i}.price`)} />
                  </FormField>
                  <FormField id={`packages.${i}.durationMinutes`} label="Minutes" error={errors.packages?.[i]?.durationMinutes?.message}>
                    <Input inputMode="numeric" {...form.register(`packages.${i}.durationMinutes`)} />
                  </FormField>
                  <Button type="button" variant="ghost" size="icon" className="sm:mt-7" onClick={() => packages.remove(i)} aria-label={`Remove package ${i + 1}`}>
                    <Trash2 aria-hidden />
                  </Button>
                  <div className="sm:col-span-4">
                    <FormField id={`packages.${i}.description`} label="What's included" error={errors.packages?.[i]?.description?.message}>
                      <Textarea rows={2} {...form.register(`packages.${i}.description`)} />
                    </FormField>
                  </div>
                </fieldset>
              ))}
              {errors.packages?.message && <p className="text-xs font-medium text-danger">{errors.packages.message}</p>}
              {packages.fields.length < 3 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => packages.append({ name: PACKAGE_NAMES[packages.fields.length] ?? "Package", description: "", price: "", durationMinutes: 60 })}
                >
                  <Plus aria-hidden /> Add package
                </Button>
              )}
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField id="depositPercent" label="Deposit paid at booking (%)" hint="0 means customers pay in full at booking." error={errors.depositPercent?.message}>
              <Input inputMode="numeric" {...form.register("depositPercent")} />
            </FormField>
          </div>
          <Checkbox
            id="requiresConfirmation"
            label="I confirm each booking myself"
            hint="Untick to accept bookings automatically when a slot is free."
            {...form.register("requiresConfirmation")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Where you work</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="locationMode" label="Location" error={errors.locationMode?.message}>
            <Select {...form.register("locationMode")}>
              <option value="on_site">I go to the customer</option>
              <option value="at_provider">Customers come to me</option>
              <option value="both">Either</option>
            </Select>
          </FormField>
          {locationMode !== "at_provider" && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField id="lgaState" label="Show LGAs in">
                  <Select value={lgaState} onChange={(e) => setLgaState(Number(e.target.value))}>
                    {lgaGroups.map((g) => (
                      <option key={g.stateId} value={g.stateId}>
                        {g.stateName}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField id="radiusKm" label="Or a radius from your base (km, optional)" error={errors.radiusKm?.message}>
                  <Input inputMode="numeric" {...form.register("radiusKm", { setValueAs: emptyToUndefined })} />
                </FormField>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-medium">LGAs you cover</legend>
                <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-3">
                  {visibleLgas.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-primary" checked={selected.has(l.id)} onChange={() => toggleLga(l.id)} />
                      {l.name}
                    </label>
                  ))}
                </div>
                {selected.size > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Selected: {[...selected].map((id) => lgaName.get(id) ?? id).join(", ")}
                  </p>
                )}
                {errors.serviceLgaIds?.message && <p className="mt-1 text-xs font-medium text-danger">{errors.serviceLgaIds.message}</p>}
              </fieldset>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly availability</CardTitle>
          <CardDescription>Bookable hours in Lagos time. Slot length is how often a booking can start; buffer is rest time between bookings.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <caption className="sr-only">Weekly availability</caption>
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-2">Day</th>
                  <th scope="col" className="py-2 pr-2">From</th>
                  <th scope="col" className="py-2 pr-2">To</th>
                  <th scope="col" className="py-2 pr-2">Slot (min)</th>
                  <th scope="col" className="py-2 pr-2">Buffer (min)</th>
                  <th scope="col" className="py-2 pr-2">Max per slot</th>
                  <th scope="col" className="py-2">
                    <span className="sr-only">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {availability.fields.map((field, i) => {
                  const e = errors.availability?.[i];
                  return (
                    <tr key={field.id} className="border-t align-top">
                      <td className="py-1 pr-2">
                        <Select aria-label={`Row ${i + 1} day`} className="h-9" {...form.register(`availability.${i}.weekday`)}>
                          {WEEKDAYS.map((d, n) => (
                            <option key={d} value={n}>
                              {d}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1 pr-2">
                        <Input type="time" aria-label={`Row ${i + 1} from`} className="h-9" aria-invalid={e?.start ? true : undefined} {...form.register(`availability.${i}.start`)} />
                        {e?.start?.message && <p className="mt-1 text-xs text-danger">{e.start.message}</p>}
                      </td>
                      <td className="py-1 pr-2">
                        <Input type="time" aria-label={`Row ${i + 1} to`} className="h-9" aria-invalid={e?.end ? true : undefined} {...form.register(`availability.${i}.end`)} />
                        {e?.end?.message && <p className="mt-1 text-xs text-danger">{e.end.message}</p>}
                      </td>
                      <td className="py-1 pr-2">
                        <Input inputMode="numeric" aria-label={`Row ${i + 1} slot minutes`} className="h-9" {...form.register(`availability.${i}.slotMinutes`)} />
                      </td>
                      <td className="py-1 pr-2">
                        <Input inputMode="numeric" aria-label={`Row ${i + 1} buffer minutes`} className="h-9" {...form.register(`availability.${i}.bufferMinutes`)} />
                      </td>
                      <td className="py-1 pr-2">
                        <Input inputMode="numeric" aria-label={`Row ${i + 1} max per slot`} className="h-9" {...form.register(`availability.${i}.maxPerSlot`)} />
                      </td>
                      <td className="py-1">
                        <Button type="button" variant="ghost" size="sm" onClick={() => availability.remove(i)} aria-label={`Remove row ${i + 1}`}>
                          <Trash2 aria-hidden />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {errors.availability?.message && <p className="text-xs font-medium text-danger">{errors.availability.message}</p>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => availability.append({ weekday: 6, start: "09:00", end: "14:00", slotMinutes: 60, bufferMinutes: 0, maxPerSlot: 1 })}
          >
            <Plus aria-hidden /> Add hours
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Days off</CardTitle>
          <CardDescription>Holidays or other times you can&apos;t take bookings.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {blackouts.fields.map((field, i) => (
            <div key={field.id} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
              <FormField id={`blackouts.${i}.startsAt`} label="From" error={errors.blackouts?.[i]?.startsAt?.message}>
                <Input type="datetime-local" {...form.register(`blackouts.${i}.startsAt`)} />
              </FormField>
              <FormField id={`blackouts.${i}.endsAt`} label="Until" error={errors.blackouts?.[i]?.endsAt?.message}>
                <Input type="datetime-local" {...form.register(`blackouts.${i}.endsAt`)} />
              </FormField>
              <FormField id={`blackouts.${i}.reason`} label="Reason (optional)">
                <Input {...form.register(`blackouts.${i}.reason`)} />
              </FormField>
              <Button type="button" variant="ghost" size="icon" className="sm:mt-7" onClick={() => blackouts.remove(i)} aria-label={`Remove day off ${i + 1}`}>
                <Trash2 aria-hidden />
              </Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => blackouts.append({ startsAt: "", endsAt: "", reason: "" })}>
            <Plus aria-hidden /> Add days off
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Search engines</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <FormField id="slug" label="Web address" hint="Leave blank to create one from the title." error={errors.slug?.message}>
            <Input {...form.register("slug")} />
          </FormField>
          <FormField id="metaTitle" label="Page title (optional)" error={errors.metaTitle?.message}>
            <Input maxLength={70} {...form.register("metaTitle")} />
          </FormField>
          <FormField id="metaDescription" label="Page description (optional)" error={errors.metaDescription?.message}>
            <Textarea rows={2} maxLength={160} {...form.register("metaDescription")} />
          </FormField>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-3 px-4 py-3">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <div className="w-40">
            <Select id="status" {...form.register("status")}>
              <option value="draft">Draft</option>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </Select>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save service"}
          </Button>
        </div>
      </div>
    </form>
  );
}
