import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RefundStatusBadge } from "@/components/refunds/refund-status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { customerRefunds } from "@/lib/refunds/view";

export const metadata: Metadata = { title: "Refunds & returns" };

export default async function MyRefundsPage() {
  const user = await requirePermission("account.access", "/account/refunds");
  const refunds = await withRls({ userId: user.id }, (tx) => customerRefunds(tx, user.id));

  return (
    <>
      <PageHeader title="Refunds & returns" description="Refunds go back to the card, bank or wallet you paid with. To ask for one, open the order and choose “Cancel, return or get help”." />
      <Card>
        <CardContent className="pt-6">
          {refunds.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No refunds yet. If something&apos;s wrong with an order, start from{" "}
              <Link href="/account/orders" className="text-primary underline">
                your orders
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y">
              {refunds.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {r.number} · {r.shop}
                    </p>
                    <p className="text-muted-foreground">
                      {r.reason} · {r.createdAt} · order{" "}
                      <Link href={r.sellerOrderId ? `/orders/${r.orderNumber}/help/${r.sellerOrderId}` : `/account/orders/${r.orderNumber}`} className="text-primary underline">
                        {r.orderNumber}
                      </Link>
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums">{r.status === "requested" || r.status === "rejected" ? r.requested : r.total}</span>
                    <RefundStatusBadge status={r.status} label={r.statusLabel} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
