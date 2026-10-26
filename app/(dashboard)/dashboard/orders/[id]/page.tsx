import { ArrowLeft, MapPin, Phone, Printer, User } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingActions } from "@/components/bookings/booking-actions";
import { PageHeader } from "@/components/layout/app-shell";
import { OrderMessages } from "@/components/orders/order-messages";
import { BookingStatusBadge, OrderStatusBadge } from "@/components/orders/order-status-badge";
import { SellerOrderActions } from "@/components/orders/seller-order-actions";
import { OrderTimeline } from "@/components/orders/order-timeline";
import { RefundList } from "@/components/refunds/refund-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { loadConversation } from "@/lib/fulfilment/messages";
import { CONTACT_RETENTION_DAYS, loadSellerOrder } from "@/lib/fulfilment/seller-view";
import { sellerOrderRefunds } from "@/lib/refunds/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Order" };

export default async function SellerOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/orders/${id}`, "order.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withSellerRls(ctx, async (tx) => {
    const order = await loadSellerOrder(tx, ctx.business.id, id);
    if (!order) return null;
    const messages = await loadConversation(tx, { sellerOrderId: id, viewer: "seller", sellerName: ctx.business.name, customerName: order.customer.name });
    return { order, messages, money: await sellerOrderRefunds(tx, ctx.business.id, id) };
  });
  if (!data) notFound();
  const { order, messages, money } = data;
  const canManage = can(ctx.user, "order.manage", { businessId: ctx.business.id });
  const canBook = can(ctx.user, "booking.manage", { businessId: ctx.business.id });

  return (
    <>
      <PageHeader
        title={`Order ${order.orderNumber}`}
        description={`Placed ${order.placedAt} · ${order.methodLabel}${order.payOnDelivery ? " · Pay on delivery" : " · Paid online"}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="ghost">
              <Link href="/dashboard/orders">
                <ArrowLeft aria-hidden /> Orders
              </Link>
            </Button>
            {order.method !== "none" && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/print/packing-slip/${order.id}`} target="_blank">
                  <Printer aria-hidden /> Packing slip
                </Link>
              </Button>
            )}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>Items</CardTitle>
                {order.eta && <CardDescription>Promised delivery: {order.eta}</CardDescription>}
              </div>
              <OrderStatusBadge status={order.statusKey} label={order.status} />
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {order.items.map((i) => (
                  <li key={i.id} className="flex flex-col gap-3 py-3 first:pt-0 sm:flex-row">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
                      {i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" />}
                    </div>
                    <div className="flex flex-1 flex-col gap-1 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{i.title}</p>
                          {i.options && <p className="text-muted-foreground">{i.options}</p>}
                          {i.booking ? (
                            <p>
                              <span className="font-medium">{i.booking.when}</span> <span className="text-muted-foreground">· {i.booking.where}</span>
                              {i.booking.movedFrom && <span className="block text-xs text-muted-foreground">Moved from {i.booking.movedFrom}</span>}
                            </p>
                          ) : (
                            <p className="text-muted-foreground">
                              {i.qty} {i.unit} × {i.unitPrice}
                              {i.sku && <span className="font-mono text-xs"> · {i.sku}</span>}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {i.booking && <BookingStatusBadge status={i.booking.statusKey} label={i.booking.status} />}
                          <span className="font-semibold tabular-nums">{i.total}</span>
                        </div>
                      </div>
                      {i.booking?.payLater && <p className="text-xs text-muted-foreground">Collect {i.booking.payLater} from the customer on the day.</p>}
                      {i.booking && canBook && order.statusKey !== "pending_payment" && (
                        <BookingActions side="seller" booking={i.booking} steps={i.booking.steps} isRequest={i.booking.statusKey === "requested"} />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <dl className="mt-3 flex flex-col gap-1 border-t pt-3 text-sm">
                <Row label="Items" value={order.money.subtotal} />
                {order.money.discount && <Row label="Discounts" value={`−${order.money.discount}`} />}
                <Row label="Delivery" value={order.money.delivery} />
                <Row label="TownMart commission" value={`−${order.money.commission}`} />
                <Row label="You earn" value={order.money.net} strong />
                {order.money.payLater && <p className="text-xs text-muted-foreground">Includes {order.money.payLater} the customer pays you directly on the day.</p>}
              </dl>
            </CardContent>
          </Card>

          {(money.refunds.length > 0 || money.dispute) && (
            <Card id="refunds">
              <CardHeader>
                <CardTitle>Refunds</CardTitle>
                {money.dispute && (
                  <CardDescription>
                    <Link href={`/dashboard/disputes/${money.dispute.id}`} className="text-primary underline">
                      {money.dispute.status === "open" ? "The customer has asked TownMart to decide. Give your side." : "See TownMart's decision on the dispute."}
                    </Link>
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <RefundList refunds={money.refunds} side="seller" />
                {money.refunds
                  .filter((r) => r.status === "requested")
                  .map((r) => (
                    <Button key={r.id} asChild size="sm" className="self-start">
                      <Link href={`/dashboard/refunds/${r.id}`}>Answer {r.number}</Link>
                    </Button>
                  ))}
              </CardContent>
            </Card>
          )}

          <Card id="messages">
            <CardHeader>
              <CardTitle>Messages</CardTitle>
              <CardDescription>Only you and the customer see these.</CardDescription>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <OrderMessages messages={messages} sellerOrderId={order.id} side="seller" otherName={order.customer.name} />
              ) : (
                <p className="text-sm text-muted-foreground">You need order access to message customers.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex flex-col gap-6">
          {canManage && (order.steps.length > 0 || order.canCancel || order.canMarkCash) && (
            <Card>
              <CardHeader>
                <CardTitle>Next step</CardTitle>
                {order.payOnDelivery && (
                  <CardDescription>{order.cashCollectedAt ? `Payment collected ${order.cashCollectedAt}` : "Collect payment when you hand it over."}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <SellerOrderActions order={order} />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p className="flex items-center gap-2">
                <User className="size-4 text-muted-foreground" aria-hidden /> {order.customer.name}
              </p>
              {order.customer.phone ? (
                <p className="flex items-center gap-2">
                  <Phone className="size-4 text-muted-foreground" aria-hidden />
                  <a href={`tel:${order.customer.phone}`} className="text-primary underline">
                    {order.customer.phone}
                  </a>
                </p>
              ) : (
                order.customer.phoneHidden && <p className="text-xs text-muted-foreground">The phone number is hidden {CONTACT_RETENTION_DAYS} days after an order is completed.</p>
              )}
              {order.customer.address && (
                <div className="flex gap-2">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    {order.customer.address.map((l) => (
                      <p key={l}>{l}</p>
                    ))}
                  </div>
                </div>
              )}
              {order.tracking && (
                <p className="text-muted-foreground">
                  Tracking: {order.tracking.carrier ? `${order.tracking.carrier} ` : ""}
                  <span className="font-mono">{order.tracking.number}</span>
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <OrderTimeline events={order.timeline} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
