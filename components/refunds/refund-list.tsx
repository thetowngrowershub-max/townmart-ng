import { ImageIcon } from "lucide-react";
import type { RefundSummary } from "@/lib/refunds/view";
import { RefundStatusBadge } from "./refund-status-badge";

/**
 * Refunds on one part of an order, newest first. `evidenceQuery` carries the
 * guest link's token so photos open for guests too.
 */
export function RefundList({ refunds, evidenceQuery = "", side }: { refunds: RefundSummary[]; evidenceQuery?: string; side: "customer" | "seller" | "admin" }) {
  if (!refunds.length) return null;
  return (
    <ul className="flex flex-col gap-3">
      {refunds.map((r) => (
        <li key={r.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {r.number} · {r.reason}
            </p>
            <RefundStatusBadge status={r.status} label={r.statusLabel} />
          </div>
          <p className="mt-1 text-muted-foreground">
            {r.status === "requested" || r.status === "rejected" ? `Asked for ${r.requested}` : `${r.total} back to the original payment method`} · {r.createdAt}
          </p>
          {r.items.length > 0 && (
            <p className="mt-1">
              {r.items.map((i) => `${i.qty} × ${i.title}${side !== "customer" && i.restocked ? " (back in stock)" : ""}`).join(", ")}
            </p>
          )}
          {r.details && <p className="mt-2 whitespace-pre-line">“{r.details}”</p>}
          {r.evidence > 0 && (
            <p className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: r.evidence }, (_, n) => (
                <a key={n} href={`/api/refunds/${r.id}/evidence/${n}${evidenceQuery}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-primary hover:bg-muted">
                  <ImageIcon className="size-4" aria-hidden /> Photo {n + 1}
                </a>
              ))}
            </p>
          )}
          {r.respondBy && <p className="mt-2 text-xs text-muted-foreground">{side === "seller" ? `Please answer by ${r.respondBy}, or TownMart will decide.` : `The seller has until ${r.respondBy} to answer.`}</p>}
          {r.response && (
            <p className="mt-2 rounded-lg bg-muted p-2">
              <span className="font-medium">{r.status === "rejected" ? "Reason for declining: " : "Note: "}</span>
              {r.response}
            </p>
          )}
          {r.completedAt && <p className="mt-2 text-xs text-muted-foreground">Paid back {r.completedAt}. Banks can take a few working days to show it.</p>}
          {r.status === "failed" && side === "customer" && <p className="mt-2 text-xs text-muted-foreground">The payment provider hasn&apos;t paid this yet. Our team is on it; you don&apos;t need to do anything.</p>}
        </li>
      ))}
    </ul>
  );
}
