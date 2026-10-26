import { Store, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { OrderSummary } from "@/components/cart/order-summary";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderDetailView } from "@/lib/orders/view";

/** The items, per-seller status, address and totals of one order. */
export function OrderDetail({ order }: { order: OrderDetailView }) {
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        {order.sellers.map((s) => (
          <Card key={s.href}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>
                  <Link href={s.href} className="hover:underline">
                    {s.name}
                  </Link>
                </CardTitle>
                <CardDescription className="mt-1 flex items-center gap-2">
                  {s.method === "delivery" ? <Truck className="size-4" aria-hidden /> : <Store className="size-4" aria-hidden />}
                  {s.method === "delivery" ? `Delivery${s.eta ? `, ${s.eta}` : ""}` : "Pickup from the seller"}
                </CardDescription>
              </div>
              <Badge variant={order.status === "cancelled" ? "secondary" : "default"}>{s.status}</Badge>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {s.items.map((i) => (
                  <li key={i.href + i.options} className="flex gap-4 py-3 first:pt-0">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" />}
                    </div>
                    <div className="flex-1 text-sm">
                      <Link href={i.href} className="font-medium hover:underline">
                        {i.title}
                      </Link>
                      {i.options && <p className="text-muted-foreground">{i.options}</p>}
                      <p className="text-muted-foreground">
                        {i.qty} × {i.unitPrice}
                        {i.discount && <span className="text-success"> (−{i.discount})</span>}
                      </p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{i.total}</p>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 flex flex-col gap-1 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Items</dt>
                  <dd className="tabular-nums">{s.subtotal}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Delivery</dt>
                  <dd className="tabular-nums">{s.delivery}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
            <CardDescription>
              {order.paymentStatus} · {order.paymentMethod}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrderSummary totals={order.totals} totalLabel={order.payOnDelivery ? "To pay on delivery" : "Total"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Delivery address</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="font-medium">{order.address.recipientName}</p>
            {order.address.lines.map((l) => (
              <p key={l} className="text-muted-foreground">
                {l}
              </p>
            ))}
            <p className="mt-3 text-muted-foreground">Receipt sent to {order.contactEmail}</p>
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Something wrong? Read our{" "}
          <Link href="/legal/refunds" className="text-primary underline">
            Refund Policy
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}
