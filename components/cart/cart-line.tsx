"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeCartItemAction, saveForLaterAction, updateCartItemAction } from "@/lib/cart/actions";
import type { LineView } from "@/lib/checkout/view";

/** One cart line with quantity, remove and save-for-later controls. */
export function CartLine({ line, saved = false, readOnly = false }: { line: LineView; saved?: boolean; readOnly?: boolean }) {
  const router = useRouter();
  const [qty, setQty] = useState(line.qty);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : (res.fieldErrors?.qty?.[0] ?? res.error ?? "Something went wrong."));
      router.refresh();
    });

  return (
    <li className="flex gap-4 py-4" aria-busy={pending}>
      <Link href={line.href} className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
        {line.imageUrl && <Image src={line.imageUrl} alt={line.imageAlt} fill sizes="80px" className="object-cover" />}
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link href={line.href} className="font-medium hover:underline">
              {line.title}
            </Link>
            {line.options && <p className="text-sm text-muted-foreground">{line.options}</p>}
            <p className="text-sm text-muted-foreground">
              {line.unitPrice} per {line.perUnit}
            </p>
          </div>
          {!saved && (
            <div className="text-right">
              <p className="font-semibold tabular-nums">{line.total}</p>
              {line.discount && (
                <p className="text-xs text-muted-foreground">
                  <s>{line.subtotal}</s> <span className="font-medium text-success">−{line.discount}</span>
                </p>
              )}
            </div>
          )}
        </div>
        {!saved && line.promotions.length > 0 && <p className="text-xs font-medium text-success">{line.promotions.join(" + ")}</p>}
        {line.problem && (
          <p className="text-sm font-medium text-danger" role="alert">
            {line.problem}
          </p>
        )}
        {!readOnly && (
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {!saved && (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => updateCartItemAction({ itemId: line.id, qty }));
                }}
              >
                <label htmlFor={`qty-${line.id}`} className="text-muted-foreground">
                  Qty
                </label>
                <input
                  id={`qty-${line.id}`}
                  inputMode={line.step === "1" ? "numeric" : "decimal"}
                  className="h-9 w-20 rounded-lg border bg-transparent px-2 text-center tabular-nums"
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  onBlur={() => qty !== line.qty && run(() => updateCartItemAction({ itemId: line.id, qty }))}
                />
                <span className="text-muted-foreground">{line.unit}</span>
              </form>
            )}
            <button type="button" className="text-primary underline disabled:opacity-50" disabled={pending} onClick={() => run(() => saveForLaterAction({ itemId: line.id, saved: !saved }))}>
              {saved ? "Move to cart" : "Save for later"}
            </button>
            <button type="button" className="text-muted-foreground underline disabled:opacity-50" disabled={pending} onClick={() => run(() => removeCartItemAction({ itemId: line.id }))}>
              Remove
            </button>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </li>
  );
}
