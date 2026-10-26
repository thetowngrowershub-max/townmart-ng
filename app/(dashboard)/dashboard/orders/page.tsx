import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { Pagination } from "@/components/storefront/pagination";
import { Card } from "@/components/ui/card";
import { listSellerOrders, ORDER_FILTERS, type OrderFilter } from "@/lib/fulfilment/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Orders" };

const PAGE_SIZE = 20;

export default async function SellerOrdersPage({ searchParams }: { searchParams: Promise<{ show?: string; page?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/orders", "order.read");
  const sp = await searchParams;
  const filter: OrderFilter = sp.show && sp.show in ORDER_FILTERS ? (sp.show as OrderFilter) : "open";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const { rows, total, counts } = await withSellerRls(ctx, (tx) => listSellerOrders(tx, ctx.business.id, filter, page, PAGE_SIZE));

  return (
    <>
      <PageHeader title="Orders" description="Prepare, send and hand over orders. Customers are told at every step." />
      <nav aria-label="Order filters" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(ORDER_FILTERS) as OrderFilter[]).map((f) => (
          <Link
            key={f}
            href={`/dashboard/orders?show=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", f === filter ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
          >
            {ORDER_FILTERS[f].label} <span className="tabular-nums text-muted-foreground">{counts[f]}</span>
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {filter === "open" ? "Nothing to do right now. New orders appear here as soon as they're paid or placed with pay on delivery." : "No orders here."}
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Order</th>
                  <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                  <th scope="col" className="px-4 py-3 font-medium">How</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">You earn</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/orders/${o.id}`} className="font-medium hover:underline">
                        {o.orderNumber}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {o.placedAt} · {o.itemCount} item{o.itemCount === 1 ? "" : "s"}
                      </div>
                    </td>
                    <td className="px-4 py-3">{o.customer}</td>
                    <td className="px-4 py-3">
                      {o.method}
                      {o.nextBooking && <div className="text-xs text-muted-foreground">Next: {o.nextBooking}</div>}
                      {o.payOnDelivery && <div className={cn("text-xs", o.cashCollected ? "text-success" : "text-warning-foreground")}>{o.cashCollected ? "Cash collected" : "Collect payment"}</div>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.net}</td>
                    <td className="px-4 py-3">
                      <OrderStatusBadge status={o.statusKey} label={o.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} href={(n) => `/dashboard/orders?show=${filter}&page=${n}`} />
    </>
  );
}
