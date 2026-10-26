"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bulkEditVariantsAction } from "@/lib/catalogue/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export type BulkRow = { variantId: string; product: string; variant: string; sku: string; price: string; stockQty: string; tracked: boolean };

/** Spreadsheet-style price and stock editing. Only changed cells are sent. */
export function BulkEditTable({ rows }: { rows: BulkRow[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, { price?: string; stockQty?: string }>>({});
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const changed = Object.entries(edits).filter(([, e]) => e.price !== undefined || e.stockQty !== undefined);

  const set = (row: BulkRow, field: "price" | "stockQty", value: string) =>
    setEdits((prev) => {
      const next = { ...prev, [row.variantId]: { ...prev[row.variantId], [field]: value === row[field] ? undefined : value } };
      return next;
    });

  const save = () =>
    start(async () => {
      const res = await bulkEditVariantsAction({ rows: changed.map(([variantId, e]) => ({ variantId, ...e })) });
      setResult(res);
      if (res.ok) {
        setEdits({});
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-4 pb-20">
      {result && (result.ok ? <Alert variant="success">{result.message}</Alert> : <Alert variant="danger">{result.error}</Alert>)}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-2 py-3">SKU</th>
              <th scope="col" className="px-2 py-3">Price (₦)</th>
              <th scope="col" className="px-4 py-3">Stock</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const e = edits[r.variantId];
              return (
                <tr key={r.variantId}>
                  <th scope="row" className="px-4 py-2 text-left font-medium">
                    {r.product}
                    {r.variant && <span className="block text-xs font-normal text-muted-foreground">{r.variant}</span>}
                  </th>
                  <td className="px-2 py-2 font-mono text-xs">{r.sku}</td>
                  <td className="px-2 py-2">
                    <Input
                      aria-label={`${r.product} ${r.variant} price`}
                      inputMode="decimal"
                      className={`h-9 w-32 ${e?.price !== undefined ? "border-primary" : ""}`}
                      value={e?.price ?? r.price}
                      onChange={(ev) => set(r, "price", ev.target.value)}
                    />
                  </td>
                  <td className="px-4 py-2">
                    {r.tracked ? (
                      <Input
                        aria-label={`${r.product} ${r.variant} stock`}
                        inputMode="decimal"
                        className={`h-9 w-28 ${e?.stockQty !== undefined ? "border-primary" : ""}`}
                        value={e?.stockQty ?? r.stockQty}
                        onChange={(ev) => set(r, "stockQty", ev.target.value)}
                      />
                    ) : (
                      <span className="text-muted-foreground">Not tracked</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-end gap-3 px-4 py-3">
          <span className="text-sm text-muted-foreground" aria-live="polite">
            {changed.length} change{changed.length === 1 ? "" : "s"}
          </span>
          <Button variant="ghost" disabled={!changed.length || pending} onClick={() => setEdits({})}>
            Discard
          </Button>
          <Button disabled={!changed.length || pending} onClick={save}>
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
