"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
import { checkChoices, MealChoiceError, type MealBuilder, type MealChoices } from "@/lib/catalogue/meal-builder";
import { AddToCart } from "./add-to-cart";
import { MealPicker } from "./meal-picker";
import { ImageGallery, type GalleryItem } from "./image-gallery";

export type VariantView = {
  id: string;
  optionValues: Record<string, string>;
  /** What the shopper pays per unit today, promotion included. */
  priceKobo: string;
  compareAtPriceKobo: string | null;
  deal: { originalKobo: string; percentOff: number; name: string; isFlashDeal: boolean; endsLabel: string } | null;
  stock: { state: "in" | "low" | "out" | "backorder"; qty?: string };
  imageIndex: number | null;
};

/**
 * Gallery + variant picker. Prices arrive as strings (BigInt can't cross to
 * the client) and are formatted here with the same money helpers.
 */
export function ProductPurchase({
  title,
  images,
  options,
  variants,
  unitLabel,
  minOrder,
  fractional,
  closedLabel = null,
  meal = null,
  children,
}: {
  title: string;
  images: GalleryItem[];
  options: { name: string; values: string[] }[];
  variants: VariantView[];
  unitLabel: string;
  minOrder: string;
  fractional: boolean;
  /** Food from a seller that's closed right now: ordering is off and this says why. */
  closedLabel?: string | null;
  /** Restaurants: the customer builds the plate; the price adds up from the choices. */
  meal?: MealBuilder | null;
  children?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Record<string, string>>(variants[0]?.optionValues ?? {});
  const [imageIndex, setImageIndex] = useState(0);
  const variant = useMemo(() => variants.find((v) => options.every((o) => v.optionValues[o.name] === selected[o.name])), [variants, options, selected]);
  const available = (name: string, value: string) => variants.some((v) => v.optionValues[name] === value && options.every((o) => o.name === name || v.optionValues[o.name] === selected[o.name]));

  const [choices, setChoices] = useState<MealChoices>({});
  const plate = useMemo(() => {
    if (!meal) return null;
    try {
      return { ok: true as const, ...checkChoices(meal, choices) };
    } catch (err) {
      return { ok: false as const, error: err instanceof MealChoiceError ? err.message : "Check your choices.", extraKobo: 0n };
    }
  }, [meal, choices]);

  const basePrice = variant ? BigInt(variant.priceKobo) : null;
  // A built plate: what's on it, plus the item's own price (e.g. the pack).
  const price = basePrice !== null && plate ? basePrice + (plate.ok ? plate.extraKobo : 0n) : basePrice;
  const deal = variant?.deal ?? null;
  // A live promotion is struck through against the normal price; otherwise the seller's compare-at price.
  const compare = deal ? BigInt(deal.originalKobo) : variant?.compareAtPriceKobo ? BigInt(variant.compareAtPriceKobo) : null;
  const saving = price !== null && compare !== null && compare > price ? compare - price : null;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <ImageGallery images={images} activeIndex={imageIndex} onSelect={setImageIndex} />
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        <div aria-live="polite">
          {price !== null ? (
            <p className="flex flex-wrap items-baseline gap-3">
              <span className="text-3xl font-extrabold">{formatPrice(price)}</span>
              <span className="text-sm text-muted-foreground">{meal ? "per plate" : `per ${unitLabel}`}</span>
              {saving !== null && compare !== null && (
                <>
                  <s className="text-muted-foreground">{formatPrice(compare)}</s>
                  <Badge variant={deal?.isFlashDeal ? "danger" : "accent"}>
                    {deal?.isFlashDeal ? "Flash deal: " : ""}Save {formatPrice(saving)}
                    {deal && deal.percentOff >= 1 ? ` (${deal.percentOff}%)` : ""}
                  </Badge>
                </>
              )}
            </p>
          ) : (
            <p className="font-semibold text-muted-foreground">This combination isn&apos;t available.</p>
          )}
          {deal && (
            <p className="mt-1 text-sm text-muted-foreground">
              {deal.name} · ends {deal.endsLabel}
            </p>
          )}
          {variant && (
            <p className="mt-2 text-sm">
              {variant.stock.state === "in" && <span className="font-semibold text-success">In stock</span>}
              {variant.stock.state === "low" && <span className="font-semibold text-warning-foreground dark:text-warning">Only {variant.stock.qty} left</span>}
              {variant.stock.state === "out" && <span className="font-semibold text-danger">Out of stock</span>}
              {variant.stock.state === "backorder" && <span className="font-semibold">Available to order; ships when restocked</span>}
            </p>
          )}
        </div>

        {options.map((o) => (
          <fieldset key={o.name}>
            <legend className="mb-2 text-sm font-medium">
              {o.name}: <span className="font-normal">{selected[o.name]}</span>
            </legend>
            <div className="flex flex-wrap gap-2">
              {o.values.map((value) => {
                const isSelected = selected[o.name] === value;
                const can = available(o.name, value);
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => {
                      const next = { ...selected, [o.name]: value };
                      setSelected(next);
                      const v = variants.find((x) => options.every((op) => x.optionValues[op.name] === next[op.name]));
                      if (v?.imageIndex !== null && v?.imageIndex !== undefined) setImageIndex(v.imageIndex);
                    }}
                    className={cn(
                      "min-w-12 rounded-xl border px-3 py-2 text-sm",
                      isSelected ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted",
                      !can && "text-muted-foreground line-through decoration-1",
                    )}
                  >
                    {value}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}

        {Number(minOrder) !== 1 && <p className="text-sm text-muted-foreground">Minimum order: {minOrder} {unitLabel}</p>}
        {meal && (
          <section aria-label="Build your plate" className="flex flex-col gap-3">
            <MealPicker builder={meal} choices={choices} onChange={setChoices} />
            {basePrice !== null && basePrice > 0n && <p className="text-xs text-muted-foreground">Includes {formatPrice(basePrice)} for the pack.</p>}
            {plate && !plate.ok && Object.keys(choices).length > 0 && (
              <p role="status" className="text-sm font-medium">
                {plate.error}
              </p>
            )}
          </section>
        )}
        {closedLabel && (
          <p role="status" className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-medium">
            {closedLabel}. You can order once the kitchen is open.
          </p>
        )}
        <AddToCart
          key={variant?.id ?? "none"}
          variantId={variant?.id ?? null}
          disabled={!variant || variant.stock.state === "out" || Boolean(closedLabel) || (plate !== null && !plate.ok)}
          choices={plate?.ok ? plate.choices : undefined}
          label={meal ? (plate?.ok && price !== null ? `Add plate · ${formatPrice(price)}` : "Build your plate to add it") : undefined}
          minOrder={minOrder}
          fractional={fractional}
          unitLabel={unitLabel}
        />
        {children}
      </div>
    </div>
  );
}
