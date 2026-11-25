"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useFieldArray, useWatch, type UseFormReturn } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NIGERIAN_PLATE_TEMPLATE } from "@/lib/catalogue/meal-builder";
import type { ProductInput } from "@/lib/validation/catalogue";

type Form = UseFormReturn<ProductInput, unknown, unknown>;
type ErrorLike = { message?: string } | undefined;

const newItem = () => ({ name: "", price: "", unit: "portion", maxQty: "1", defaultQty: "1", swallow: false, available: true });

/**
 * The steps a customer goes through to build a plate: Meal, Soup (only with
 * swallow), Protein, Drink. Each choice has its own price per unit, so the
 * plate costs what's on it.
 */
export function MealBuilderEditor({ form }: { form: Form }) {
  const groups = useFieldArray({ control: form.control, name: "mealBuilder" });
  const err = (form.formState.errors as { mealBuilder?: ErrorLike & Record<number, unknown> }).mealBuilder;

  return (
    <div className="flex flex-col gap-5">
      {err?.message && <p className="text-xs font-medium text-danger">{err.message}</p>}
      {groups.fields.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-4 text-sm">
          <p>
            Let customers build their own plate: pick a meal (rice, swallow, yam, plantain), a soup for the swallow, a protein and a drink. The price adds up from
            what they choose. Leave this empty for dishes sold as they are.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => groups.replace(NIGERIAN_PLATE_TEMPLATE.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })))}>
              Start with a Nigerian plate
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => groups.append({ name: "", min: "1", max: "1", withSwallow: false, items: [newItem()] })}>
              Start from scratch
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            The item&apos;s price above is charged once per plate (for example the takeaway pack). Set it to 0 if everything is priced below. Swallow is sold by the
            wrap: tick &quot;Swallow&quot; and customers choose how many wraps, and a step marked &quot;Only with swallow&quot; (soups) then appears.
          </p>
          {groups.fields.map((g, gi) => (
            <GroupEditor
              key={g.id}
              form={form}
              index={gi}
              count={groups.fields.length}
              onRemove={() => groups.remove(gi)}
              onMove={(to) => groups.move(gi, to)}
              errors={(err as Record<number, unknown> | undefined)?.[gi] as GroupErrors | undefined}
            />
          ))}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => groups.append({ name: "", min: "0", max: "1", withSwallow: false, items: [newItem()] })}>
            <Plus aria-hidden /> Add a step
          </Button>
        </>
      )}
    </div>
  );
}

type GroupErrors = { name?: ErrorLike; min?: ErrorLike; max?: ErrorLike; items?: ErrorLike & Record<number, Record<string, ErrorLike>> };

function GroupEditor({ form, index, count, onRemove, onMove, errors }: { form: Form; index: number; count: number; onRemove: () => void; onMove: (to: number) => void; errors?: GroupErrors }) {
  const items = useFieldArray({ control: form.control, name: `mealBuilder.${index}.items` });
  const name = useWatch({ control: form.control, name: `mealBuilder.${index}.name` }) as string | undefined;
  const p = `mealBuilder.${index}` as const;
  const firstError = errors?.name?.message ?? errors?.min?.message ?? errors?.max?.message ?? errors?.items?.message;

  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border p-4">
      <legend className="px-1 text-sm font-semibold">{name || `Step ${index + 1}`}</legend>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium">
          Step name
          <Input className="w-44" placeholder="e.g. Protein" {...form.register(`${p}.name`)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Fewest choices
          <Input className="w-24" inputMode="numeric" {...form.register(`${p}.min`)} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Most choices
          <Input className="w-24" inputMode="numeric" {...form.register(`${p}.max`)} />
        </label>
        <div className="pb-2">
          <Checkbox id={`${p}.withSwallow`} label="Only with swallow" hint="For soups." {...form.register(`${p}.withSwallow`)} />
        </div>
        <div className="ml-auto flex gap-1">
          <Button type="button" variant="ghost" size="icon" aria-label="Move step up" disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUp aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Move step down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            <ArrowDown aria-hidden />
          </Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Remove step" onClick={onRemove}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Fewest 0 makes the step optional (e.g. drinks).</p>
      {firstError && <p className="text-xs font-medium text-danger">{firstError}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Choice</th>
              <th className="py-1 pr-2 font-medium">Price (₦) each</th>
              <th className="py-1 pr-2 font-medium">Sold by</th>
              <th className="py-1 pr-2 font-medium">Most per plate</th>
              <th className="py-1 pr-2 font-medium">Default</th>
              <th className="py-1 pr-2 font-medium">Swallow</th>
              <th className="py-1 pr-2 font-medium">Available</th>
              <th className="py-1 font-medium">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.fields.map((it, ii) => {
              const ip = `${p}.items.${ii}` as const;
              const e = errors?.items?.[ii];
              const msg = e && Object.values(e).find((x) => x?.message)?.message;
              return (
                <tr key={it.id} className="align-top">
                  <td className="py-1 pr-2">
                    <Input aria-label="Choice name" placeholder="e.g. Amala" {...form.register(`${ip}.name`)} />
                    {msg && <p className="mt-1 text-xs font-medium text-danger">{msg}</p>}
                  </td>
                  <td className="py-1 pr-2">
                    <Input aria-label="Price each" inputMode="decimal" className="w-24" {...form.register(`${ip}.price`)} />
                  </td>
                  <td className="py-1 pr-2">
                    <Input aria-label="Sold by" className="w-24" placeholder="wrap" {...form.register(`${ip}.unit`)} />
                  </td>
                  <td className="py-1 pr-2">
                    <Input aria-label="Most per plate" inputMode="numeric" className="w-16" {...form.register(`${ip}.maxQty`)} />
                  </td>
                  <td className="py-1 pr-2">
                    <Input aria-label="Default quantity" inputMode="numeric" className="w-16" {...form.register(`${ip}.defaultQty`)} />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label="Swallow (sold by the wrap)" className="size-5 accent-primary" {...form.register(`${ip}.swallow`)} />
                  </td>
                  <td className="py-2 pr-2">
                    <input type="checkbox" aria-label="Available today" className="size-5 accent-primary" {...form.register(`${ip}.available`)} />
                  </td>
                  <td className="py-1">
                    <Button type="button" variant="ghost" size="icon" aria-label="Remove choice" onClick={() => items.remove(ii)}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => items.append(newItem())}>
        <Plus aria-hidden /> Add a choice
      </Button>
    </fieldset>
  );
}
