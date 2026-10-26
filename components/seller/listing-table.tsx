"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bulkProductStatusAction, bulkServiceStatusAction } from "@/lib/catalogue/actions";
import type { ActionResult } from "@/lib/validation/form-result";

export type ListingRow = {
  id: string;
  title: string;
  href: string;
  imageUrl: string | null;
  price: string;
  status: "draft" | "active" | "archived";
  detail: string;
  warning?: string;
};

const STATUS_VARIANT = { draft: "secondary", active: "success", archived: "outline" } as const;

/** Listing table with select-all and bulk status changes. */
export function ListingTable({ kind, rows }: { kind: "product" | "service"; rows: ListingRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const allSelected = rows.length > 0 && selected.size === rows.length;

  const setStatus = (status: ListingRow["status"]) =>
    start(async () => {
      const input = { ids: [...selected], status };
      const res = kind === "product" ? await bulkProductStatusAction(input) : await bulkServiceStatusAction(input);
      setResult(res);
      if (res.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });

  return (
    <div className="flex flex-col gap-3">
      {result && (result.ok ? <Alert variant="success">{result.message}</Alert> : <Alert variant="danger">{result.error}</Alert>)}
      <div className="flex min-h-9 flex-wrap items-center gap-2" aria-live="polite">
        {selected.size > 0 && (
          <>
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("active")}>
              Publish
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("draft")}>
              Unpublish
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setStatus("archived")}>
              Archive
            </Button>
          </>
        )}
      </div>
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th scope="col" className="px-2 py-3">{kind === "product" ? "Product" : "Service"}</th>
              <th scope="col" className="px-2 py-3">Price</th>
              <th scope="col" className="px-2 py-3">{kind === "product" ? "Stock" : "Schedule"}</th>
              <th scope="col" className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={`Select ${r.title}`}
                    checked={selected.has(r.id)}
                    onChange={() => {
                      const next = new Set(selected);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      setSelected(next);
                    }}
                  />
                </td>
                <td className="px-2 py-3">
                  <div className="flex items-center gap-3">
                    {r.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- small thumbnail of the seller's own image
                      <img src={r.imageUrl} alt="" className="size-10 rounded-lg object-cover" />
                    ) : (
                      <div className="size-10 rounded-lg bg-muted" aria-hidden />
                    )}
                    <Link href={r.href} className="font-semibold hover:underline">
                      {r.title}
                    </Link>
                  </div>
                </td>
                <td className="px-2 py-3 whitespace-nowrap">{r.price}</td>
                <td className="px-2 py-3">
                  {r.detail}
                  {r.warning && (
                    <Badge variant="warning" className="ml-2">
                      {r.warning}
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant={STATUS_VARIANT[r.status]} className="capitalize">
                    {r.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
