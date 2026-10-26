import { CalendarCheck, LifeBuoy, Store, Truck } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { OrderSummary } from "@/components/cart/order-summary";
import { BookingActions } from "@/components/bookings/booking-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MessageView } from "@/lib/fulfilment/messages";
import type { OrderDetailView } from "@/lib/orders/view";
import { ConfirmReceived } from "./confirm-received";
import { OrderMessages } from "./order-messages";
import { BookingStatusBadge } from "./order-status-badge";
import { OrderTimeline } from "./order-timeline";

/**
 * The items, per-seller status and history, address and totals of one order,
 * with what the customer can do: confirm delivery, change bookings, message
 * the seller and review what they bought. `token` is the guest link's secret.
 */
export function OrderDetail({ order, token = null, conversations = {} }: { order: OrderDetailView; token?: string | null; conversations?: Record<string, MessageView[]> }) {
  const live = order.status !== "awaiting_payment" && order.status !== "cancelled";
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-6">
        {order.sellers.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>
                  <Link href={s.href} className="hover:underline">
                    {s.name}
                  </Link>
                </CardTitle>
                <CardDescription className="mt-1 flex items-center gap-2">
                  {s.method === "delivery" ? <Truck className="size-4" aria-hidden /> : s.method === "pickup" ? <Store className="size-4" aria-hidden /> : <CalendarCheck className="size-4" aria-hidden />}
                  {s.method === "delivery" ? `Delivery${s.eta ? `, ${s.eta}` : ""}` : s.method === "pickup" ? "Pickup from the seller" : "Booking"}
                </CardDescription>
                {s.tracking && (
                  <p className="mt-1 text-sm">
                    Tracking: {s.tracking.carrier ? `${s.tracking.carrier} ` : ""}
                    <span className="font-mono">{s.tracking.number}</span>
                  </p>
                )}
              </div>
              <Badge variant={order.status === "cancelled" ? "secondary" : "default"}>{s.status}</Badge>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {s.items.map((i) => (
                  <li key={i.id} className="flex gap-4 py-3 first:pt-0">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" />}
                    </div>
                    <div className="flex-1 text-sm">
                      <Link href={i.href} className="font-medium hover:underline">
                        {i.title}
                      </Link>
                      {i.options && <p className="text-muted-foreground">{i.options}</p>}
                      {i.booking ? (
                        <div className="mt-1 flex flex-col gap-2">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{i.booking.when}</span>
                            <span className="text-muted-foreground">· {i.booking.where}</span>
                            <BookingStatusBadge status={i.booking.statusKey} label={i.booking.status} />
                          </p>
                          {i.booking.payLater && <p className="text-xs text-muted-foreground">Pay {i.booking.payLater} to the provider on the day.</p>}
                          {live && <BookingActions side="customer" orderNumber={order.orderNumber} token={token} booking={i.booking} />}
                        </div>
                      ) : (
                        <p className="text-muted-foreground">
                          {i.qty} × {i.unitPrice}
                          {i.discount && <span className="text-success"> (−{i.discount})</span>}
                        </p>
                      )}
                      {i.canReview && (
                        <Link href={`/account/reviews/new?item=${i.id}`} className="mt-1 inline-block text-sm font-medium text-primary underline">
                          Write a review
                        </Link>
                      )}
                      {i.reviewRating !== null && <p className="mt-1 text-xs text-muted-foreground">You rated this {i.reviewRating}/5. Thank you!</p>}
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
                {s.method !== "none" && (
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Delivery</dt>
                    <dd className="tabular-nums">{s.delivery}</dd>
                  </div>
                )}
              </dl>
              {s.canConfirmReceived && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft p-3 text-sm">
                  <p>Has it arrived in good condition?</p>
                  <ConfirmReceived orderNumber={order.orderNumber} token={token} sellerOrderId={s.id} />
                </div>
              )}
              {(live || s.refunds.refunded) && s.statusKey !== "pending_payment" && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm">
                  <p className="text-muted-foreground">
                    {s.refunds.disputeOpen
                      ? "TownMart is looking into this part of your order."
                      : s.refunds.waiting
                        ? "Your refund request is with the seller."
                        : s.refunds.refunded
                          ? `${s.refunds.refunded} refunded.`
                          : "Something not right?"}
                  </p>
                  <Link href={`/orders/${order.orderNumber}/help/${s.id}${token ? `?t=${encodeURIComponent(token)}` : ""}`} className="inline-flex items-center gap-1 font-medium text-primary underline">
                    <LifeBuoy className="size-4" aria-hidden /> {s.refunds.waiting || s.refunds.disputeOpen ? "See details" : "Cancel, return or get help"}
                  </Link>
                </div>
              )}
              {live && s.timeline.length > 0 && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer font-medium text-primary">Tracking and updates</summary>
                  <div className="mt-3">
                    <OrderTimeline events={s.timeline} />
                  </div>
                </details>
              )}
              {live && (
                <details className="mt-3 text-sm" open={(conversations[s.id]?.length ?? 0) > 0}>
                  <summary className="cursor-pointer font-medium text-primary">Message {s.name}{s.messageCount ? ` (${s.messageCount})` : ""}</summary>
                  <div className="mt-3">
                    <OrderMessages messages={conversations[s.id] ?? []} sellerOrderId={s.id} side="customer" orderNumber={order.orderNumber} token={token} otherName={s.name} />
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <aside className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Payment</CardTitle>
            <CardDescription>
              {order.paymentStatus === order.paymentMethod ? order.paymentStatus : `${order.paymentStatus} · ${order.paymentMethod}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OrderSummary totals={order.totals} totalLabel={order.payOnDelivery ? "To pay on delivery" : "Total paid"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{order.sellers.every((s) => s.method === "none") ? "Your address" : "Delivery address"}</CardTitle>
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
