import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { PAYMENT_STATUS_LABELS } from "@/lib/orders/view";

export const metadata: Metadata = { title: "My orders" };

export default async function OrdersPage() {
  const user = await requirePermission("account.access", "/account/orders");
  // RLS limits this to the shopper's own orders.
  const orders = await withRls({ userId: user.id }, (tx) =>
    tx.order.findMany({
      orderBy: { placedAt: "desc" },
      take: 50,
      select: {
        orderNumber: true,
        placedAt: true,
        totalKobo: true,
        paymentStatus: true,
        cancelledAt: true,
        sellerOrders: { select: { business: { select: { name: true } }, _count: { select: { items: true } } } },
      },
    }),
  );

  return (
    <>
      <PageHeader title="My orders" description="Everything you've ordered on TownMart." />
      {orders.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="text-muted-foreground">You haven&apos;t ordered anything yet.</p>
            <Button asChild>
              <Link href="/">Start shopping</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {orders.map((o) => {
            const items = o.sellerOrders.reduce((n, s) => n + s._count.items, 0);
            return (
              <li key={o.orderNumber}>
                <Link href={`/account/orders/${o.orderNumber}`} className="block rounded-2xl border bg-card p-4 transition-colors hover:border-primary">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{o.orderNumber}</span>
                    {o.cancelledAt ? <Badge variant="secondary">Cancelled</Badge> : <Badge variant={o.paymentStatus === "unpaid" ? "warning" : "default"}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatDateTime(o.placedAt)} · {items} item{items === 1 ? "" : "s"} from {o.sellerOrders.map((s) => s.business.name).join(", ")}
                  </p>
                  <p className="mt-1 font-semibold tabular-nums">{formatPrice(o.totalKobo)}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
