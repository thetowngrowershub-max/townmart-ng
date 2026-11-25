import { MapPin, Phone, Store, User } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { OrderMessages } from "@/components/orders/order-messages";
import { RiderJobActions } from "@/components/rider/rider-job-actions";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { loadRiderJob } from "@/lib/fulfilment/rider-job-view";

// A private link: never indexed, never cached, never sent on as a referrer.
export const metadata: Metadata = { title: "Delivery job", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

function Stop({ icon, title, name, phone, lines, mapUrl, note }: { icon: ReactNode; title: string; name: string; phone: string; lines: string[]; mapUrl: string; note?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div>
          <p className="font-semibold">{name}</p>
          {lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a href={`tel:${phone}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border font-medium hover:bg-muted">
            <Phone className="size-4" aria-hidden /> Call
          </a>
          <a href={mapUrl} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl border font-medium hover:bg-muted">
            <MapPin className="size-4" aria-hidden /> Directions
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

/** The rider's job page, opened from the text TownMart sent them. No sign-in: the link is the key. */
export default async function RiderJobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const job = await loadRiderJob(token);
  if (!job) notFound();
  const delivered = job.status === "delivered";

  return (
    <main id="main" className="mx-auto flex max-w-lg flex-col gap-4 px-4 py-6">
      <header>
        <p className="text-sm text-muted-foreground">TownMart delivery · {job.riderName}</p>
        <h1 className="text-2xl font-bold">Order {job.orderNumber}</h1>
        <p className="text-sm">{delivered ? `Delivered ${job.deliveredAt}` : job.pickedUpAt ? `Picked up ${job.pickedUpAt}. Now take it to the customer.` : `Collect it from ${job.shop.name}.`}</p>
      </header>

      {job.collect && !delivered && (
        <Alert variant="warning">
          <strong>Pay on delivery.</strong> {job.collect.amount ? `Collect ${job.collect.amount} from the customer.` : "Check the amount to collect with the shop."}
        </Alert>
      )}

      <RiderJobActions token={token} pickedUp={job.pickedUpAt !== null} delivered={delivered} />

      <Stop icon={<Store className="size-4" aria-hidden />} title="1. Pick up" name={job.shop.name} phone={job.shop.phone} lines={job.shop.lines} mapUrl={job.shop.mapUrl} />
      <Stop
        icon={<User className="size-4" aria-hidden />}
        title="2. Deliver to"
        name={job.customer.name}
        phone={job.customer.phone}
        lines={job.customer.lines}
        mapUrl={job.customer.mapUrl}
        note={job.customer.approximate ? "Directions use the address. Call the customer if you can't find it." : undefined}
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Items</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y text-sm">
            {job.items.map((i, n) => (
              <li key={n} className="flex justify-between gap-3 py-2">
                <span>
                  {i.title}
                  {i.options && <span className="text-muted-foreground"> · {i.options}</span>}
                </span>
                <span className="shrink-0 tabular-nums">× {i.qty}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card id="messages">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Messages with the customer and shop</CardTitle>
        </CardHeader>
        <CardContent>
          {delivered ? (
            <p className="text-sm text-muted-foreground">This delivery is finished, so messages are closed.</p>
          ) : (
            <OrderMessages messages={job.messages} sellerOrderId={job.sellerOrderId} side="rider" token={token} otherName="the customer and shop" />
          )}
        </CardContent>
      </Card>
    </main>
  );
}
