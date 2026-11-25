"use client";

import { Minus, Plus } from "lucide-react";
import { visibleGroups, type MealBuilder, type MealChoices, type MealGroup, type MealItem } from "@/lib/catalogue/meal-builder";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

const plural = (n: number, unit: string) => (n === 1 ? unit : unit.endsWith("s") ? unit : `${unit}s`);

function groupHint(g: MealGroup): string {
  if (g.min === 0) return g.max === 1 ? "Optional · choose 1" : `Optional · up to ${g.max}`;
  if (g.min === g.max) return g.min === 1 ? "Required · choose 1" : `Required · choose ${g.min}`;
  return `Required · choose ${g.min} to ${g.max}`;
}

/**
 * Build-your-plate for restaurants: one section per step (Meal, Soup,
 * Protein, Drink). A step that allows one choice behaves like radio buttons;
 * items sold by the wrap or piece get a quantity stepper. Soups appear once
 * a swallow is on the plate.
 */
export function MealPicker({ builder, choices, onChange }: { builder: MealBuilder; choices: MealChoices; onChange: (next: MealChoices) => void }) {
  const groups = visibleGroups(builder, choices);

  const setQty = (g: MealGroup, item: MealItem, qty: number) => {
    const current = { ...(choices[g.key] ?? {}) };
    if (qty <= 0) delete current[item.key];
    else {
      // One choice allowed: picking another replaces it.
      if (g.max === 1) for (const k of Object.keys(current)) if (k !== item.key) delete current[k];
      current[item.key] = Math.min(qty, item.maxQty);
    }
    const next = { ...choices, [g.key]: current };
    if (!Object.keys(current).length) delete next[g.key];
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-5">
      {groups.map((g) => {
        const picked = choices[g.key] ?? {};
        const count = Object.keys(picked).length;
        const full = g.max > 1 && count >= g.max;
        const single = g.max === 1;
        return (
          <fieldset key={g.key} className="flex flex-col gap-2">
            <legend className="mb-1 flex w-full flex-wrap items-baseline justify-between gap-2">
              <span className="text-base font-semibold">{g.name}</span>
              <span className={cn("text-xs", g.min > count ? "font-semibold text-accent-foreground dark:text-accent" : "text-muted-foreground")}>{groupHint(g)}</span>
            </legend>
            {g.withSwallow && <p className="text-xs text-muted-foreground">For your swallow.</p>}
            <ul className="flex flex-col divide-y rounded-xl border">
              {g.items.map((i) => {
                const qty = picked[i.key] ?? 0;
                const on = qty > 0;
                const blocked = !i.available || (!on && full);
                const id = `meal-${g.key}-${i.key}`;
                return (
                  <li key={i.key} className={cn("flex flex-wrap items-center gap-3 px-3 py-2.5", on && "bg-primary-soft/60", !i.available && "opacity-60")}>
                    <input
                      id={id}
                      type={single ? "radio" : "checkbox"}
                      name={single ? `meal-${g.key}` : undefined}
                      className="size-5 shrink-0 accent-primary"
                      checked={on}
                      disabled={blocked}
                      onChange={(e) => setQty(g, i, e.target.checked ? i.defaultQty : 0)}
                      onClick={() => {
                        // Lets an optional single choice (e.g. a drink) be unticked.
                        if (single && on && g.min === 0) setQty(g, i, 0);
                      }}
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 text-sm">
                      <span className="font-medium">{i.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatPrice(BigInt(i.priceKobo))}
                        {i.maxQty > 1 || i.unit !== "portion" ? ` per ${i.unit}` : ""}
                        {!i.available && " · finished for today"}
                        {i.swallow && i.available && " · most people take 2 wraps"}
                      </span>
                    </label>
                    {on && i.maxQty > 1 && (
                      <div className="flex items-center rounded-lg border bg-card" role="group" aria-label={`${i.name}: how many ${plural(2, i.unit)}`}>
                        <button type="button" className="grid size-9 place-items-center rounded-l-lg hover:bg-muted disabled:opacity-40" disabled={qty <= 1} onClick={() => setQty(g, i, qty - 1)} aria-label={`One ${i.unit} less`}>
                          <Minus className="size-4" aria-hidden />
                        </button>
                        <span className="min-w-20 px-2 text-center text-sm font-semibold tabular-nums" aria-live="polite">
                          {qty} {plural(qty, i.unit)}
                        </span>
                        <button type="button" className="grid size-9 place-items-center rounded-r-lg hover:bg-muted disabled:opacity-40" disabled={qty >= i.maxQty} onClick={() => setQty(g, i, qty + 1)} aria-label={`One ${i.unit} more`}>
                          <Plus className="size-4" aria-hidden />
                        </button>
                      </div>
                    )}
                    {on && <span className="w-20 text-right text-sm font-semibold tabular-nums">{formatPrice(BigInt(i.priceKobo) * BigInt(qty))}</span>}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}
