"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";
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
  children,
}: {
  title: string;
  images: GalleryItem[];
  options: { name: string; values: string[] }[];
  variants: VariantView[];
  unitLabel: string;
  minOrder: string;
  children?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Record<string, string>>(variants[0]?.optionValues ?? {});
  const [imageIndex, setImageIndex] = useState(0);
  const variant = useMemo(() => variants.find((v) => options.every((o) => v.optionValues[o.name] === selected[o.name])), [variants, options, selected]);
  const available = (name: string, value: string) => variants.some((v) => v.optionValues[name] === value && options.every((o) => o.name === name || v.optionValues[o.name] === selected[o.name]));

  const price = variant ? BigInt(variant.priceKobo) : null;
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
              <span className="text-sm text-muted-foreground">per {unitLabel}</span>
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
        {children}
      </div>
    </div>
  );
}
