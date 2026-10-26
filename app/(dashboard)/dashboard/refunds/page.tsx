import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RefundStatusBadge } from "@/components/refunds/refund-status-badge";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { listSellerRefunds, REFUND_FILTERS, type RefundFilter } from "@/lib/refunds/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Refunds & disputes" };

export default async function SellerRefundsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/refunds", "order.read");
  const sp = await searchParams;
  const filter: RefundFilter = sp.show && sp.show in REFUND_FILTERS ? (sp.show as RefundFilter) : "waiting";
  const { counts, refunds, disputes } = await withSellerRls(ctx, (tx) => listSellerRefunds(tx, ctx.business.id, filter));

  return (
    <>
      <PageHeader title="Refunds & disputes" description="Answer refund requests before the deadline, or TownMart decides for you. Approved refunds come off your balance." />
      <nav aria-label="Refund filters" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(REFUND_FILTERS) as RefundFilter[]).map((f) => (
          <Link
            key={f}
            href={`/dashboard/refunds?show=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", f === filter ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
          >
            {REFUND_FILTERS[f]} <span className="tabular-nums text-muted-foreground">{counts[f]}</span>
          </Link>
        ))}
      </nav>
      {filter === "disputes" ? (
        disputes.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">No disputes. When a customer asks TownMart to decide, it shows here and you can give your side.</Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <ul className="divide-y">
              {disputes.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                  <div className="min-w-0">
                    <Link href={`/dashboard/disputes/${d.id}`} className="font-medium hover:underline">
                      Order {d.orderNumber} · {d.customer}
                    </Link>
                    <p className="line-clamp-1 text-muted-foreground">{d.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Opened {d.openedAt} · last message {d.lastMessageAt}
                    </p>
                  </div>
                  <Badge variant={d.status === "Open" ? "warning" : "secondary"}>{d.outcome ?? d.status}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : refunds.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">{filter === "waiting" ? "No refund requests waiting for you." : "No refunds yet."}</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Refund</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium">Reason</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {refunds.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/refunds/${r.id}`} className="font-medium hover:underline">
                        {r.number}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        Order {r.orderNumber} · {r.createdAt}
                      </div>
                    </td>
                    <td className="px-4 py-3">{r.customer}</td>
                    <td className="px-4 py-3">
                      {r.reason}
                      {r.respondBy && <div className="text-xs text-warning-foreground">Answer by {r.respondBy}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.amount}</td>
                    <td className="px-4 py-3">
                      <RefundStatusBadge status={r.status} label={r.statusLabel} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
