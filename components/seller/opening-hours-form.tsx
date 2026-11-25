"use client";

import { useWatch } from "react-hook-form";
import { useActionForm } from "@/components/auth/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { WEEKDAYS } from "@/lib/catalogue/units";
import { saveOpeningHoursAction } from "@/lib/seller/actions";
import { openingHoursSchema, type OpeningHoursInput } from "@/lib/validation/seller";

/** Monday first on screen; stored Sunday first. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

export function OpeningHoursForm({ initial }: { initial: OpeningHoursInput }) {
  const { form, onSubmit, pending, result } = useActionForm(openingHoursSchema, saveOpeningHoursAction, initial);
  const errors = form.formState.errors;
  const [useHours, days] = useWatch({ control: form.control, name: ["useHours", "days"] }) as [boolean, OpeningHoursInput["days"]];

  function copyMondayToAll() {
    const monday = form.getValues("days.1");
    for (let d = 0; d < 7; d++) if (d !== 1) form.setValue(`days.${d}`, { ...monday }, { shouldDirty: true });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {result && (result.ok ? <Alert variant="success">{result.message}</Alert> : <Alert variant="danger">{result.error}</Alert>)}
      <Checkbox
        id="ordersPaused"
        label="Pause new orders"
        hint="For a busy kitchen or a short break. Shoppers see that you're not taking orders, and your listings stay up."
        {...form.register("ordersPaused")}
      />
      <Checkbox
        id="useHours"
        label="Only take orders during opening hours"
        hint="Best for restaurants, bakeries and anything cooked to order. Times are Nigerian time; a closing time of 00:00 means midnight."
        {...form.register("useHours")}
      />
      {errors.useHours && <p className="text-xs font-medium text-danger">{errors.useHours.message}</p>}
      {useHours && (
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Opening hours</legend>
          {DISPLAY_ORDER.map((d) => {
            const dayErrors = errors.days?.[d];
            const isOpen = days?.[d]?.isOpen ?? false;
            return (
              <div key={d} className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="w-32">
                    <Checkbox id={`days.${d}.isOpen`} label={WEEKDAYS[d]} {...form.register(`days.${d}.isOpen`)} />
                  </div>
                  {isOpen ? (
                    <div className="flex items-center gap-2">
                      <Input type="time" aria-label={`${WEEKDAYS[d]} opening time`} className="w-32" {...form.register(`days.${d}.open`)} />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input type="time" aria-label={`${WEEKDAYS[d]} closing time`} className="w-32" {...form.register(`days.${d}.close`)} />
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Closed</span>
                  )}
                </div>
                {(dayErrors?.open || dayErrors?.close) && <p className="text-xs font-medium text-danger">{dayErrors.open?.message ?? dayErrors.close?.message}</p>}
              </div>
            );
          })}
          <Button type="button" variant="outline" size="sm" className="self-start" onClick={copyMondayToAll}>
            Use Monday&apos;s hours every day
          </Button>
        </fieldset>
      )}
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Saving…" : "Save opening hours"}
      </Button>
    </form>
  );
}
