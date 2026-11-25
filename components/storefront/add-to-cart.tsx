"use client";

import { Check, Minus, Plus, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { queueAdd } from "@/components/pwa/cart-queue";
import { isNetworkError } from "@/components/pwa/use-online";
import { addToCartAction } from "@/lib/cart/actions";
import type { MealChoices } from "@/lib/catalogue/meal-builder";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

/** Quantity stepper and Add to cart for the selected variant. */
export function AddToCart({
  variantId,
  disabled,
  minOrder,
  fractional,
  unitLabel,
  choices,
  label,
  itemName = "An item",
}: {
  variantId: string | null;
  disabled: boolean;
  minOrder: string;
  fractional: boolean;
  unitLabel: string;
  /** A built plate (restaurants). */
  choices?: MealChoices;
  label?: string;
  /** Names the item in the offline queue notice. */
  itemName?: string;
}) {
  const router = useRouter();
  const min = Number(minOrder) || 1;
  const step = fractional ? 0.5 : 1;
  const [qty, setQty] = useState(fmt(min));
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string; queued?: boolean } | null>(null);

  const bump = (d: number) => setQty((q) => fmt(Math.max(min, (Number(q) || min) + d)));
  const add = () =>
    start(async () => {
      if (!variantId) return;
      // No connection: keep the add on the phone and send it when the connection is back.
      if (!navigator.onLine) {
        queueAdd({ variantId, qty, label: itemName, ...(choices ? { choices } : {}) });
        setResult({ ok: true, queued: true, message: "You're offline, so we saved this. It goes into your cart when you're back online, at the price then." });
        return;
      }
      try {
        const res = await addToCartAction({ variantId, qty, ...(choices ? { choices } : {}) });
        setResult(res.ok ? { ok: true, message: res.message ?? "Added to your cart." } : { ok: false, message: res.fieldErrors?.qty?.[0] ?? res.error });
        if (res.ok) router.refresh();
      } catch (err) {
        // The request may or may not have arrived, so it isn't sent again by itself.
        setResult({ ok: false, message: isNetworkError(err) ? "The connection dropped. Check your cart, then try again if it isn't there." : "Something went wrong. Please try again." });
      }
    });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center rounded-xl border" role="group" aria-label="Quantity">
          <button type="button" className="grid size-11 place-items-center rounded-l-xl hover:bg-muted disabled:opacity-40" onClick={() => bump(-step)} disabled={Number(qty) <= min} aria-label="Decrease quantity">
            <Minus className="size-4" aria-hidden />
          </button>
          <label htmlFor="qty" className="sr-only">
            Quantity ({unitLabel})
          </label>
          <input
            id="qty"
            inputMode={fractional ? "decimal" : "numeric"}
            className="h-11 w-16 border-x bg-transparent text-center text-sm font-semibold tabular-nums"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(fractional ? /[^\d.]/g : /\D/g, "").slice(0, 8))}
          />
          <button type="button" className="grid size-11 place-items-center rounded-r-xl hover:bg-muted" onClick={() => bump(step)} aria-label="Increase quantity">
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
        <Button type="button" size="lg" className="flex-1 sm:flex-none" disabled={disabled || pending || !variantId} onClick={add}>
          <ShoppingCart aria-hidden /> {pending ? "Adding…" : (label ?? "Add to cart")}
        </Button>
      </div>
      <div aria-live="polite">
        {result?.ok && (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <Check className="size-4" aria-hidden /> {result.message}{" "}
            {!result.queued && (
              <Link href="/cart" className="text-primary underline">
                View cart
              </Link>
            )}
          </p>
        )}
        {result && !result.ok && <Alert variant="danger">{result.message}</Alert>}
      </div>
    </div>
  );
}
