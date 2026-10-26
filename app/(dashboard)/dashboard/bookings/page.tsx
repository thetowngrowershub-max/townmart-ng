import type { Metadata } from "next";
import Link from "next/link";
import { BookingActions } from "@/components/bookings/booking-actions";
import { PageHeader } from "@/components/layout/app-shell";
import { BookingStatusBadge } from "@/components/orders/order-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { sellerBookings } from "@/lib/bookings/lists";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bookings" };

const VIEWS = { upcoming: "Coming up", requests: "Requests", past: "Past 2 weeks" } as const;
type View = keyof typeof VIEWS;

export default async function SellerBookingsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/bookings", "order.read");
  const sp = await searchParams;
  const view: View = sp.show && sp.show in VIEWS ? (sp.show as View) : "upcoming";
  const { days, counts } = await withSellerRls(ctx, (tx) => sellerBookings(tx, ctx.business.id, view));
  const canBook = can(ctx.user, "booking.manage", { businessId: ctx.business.id });

  return (
    <>
      <PageHeader title="Bookings" description="Your diary, day by day. Customers are told when you confirm, move or cancel." />
      <nav aria-label="Booking filters" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={`/dashboard/bookings?show=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", v === view ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
          >
            {VIEWS[v]}
            {v !== "past" && <span className="ml-1 tabular-nums text-muted-foreground">{counts[v]}</span>}
          </Link>
        ))}
      </nav>
      {days.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {view === "requests" ? "No requests waiting for you." : view === "upcoming" ? "No bookings coming up. Bookings appear here as soon as customers book." : "No bookings in the past two weeks."}
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {days.map((d) => (
            <Card key={d.date}>
              <CardHeader>
                <CardTitle className="text-base">{d.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {d.rows.map((b) => (
                    <li key={b.id} className="flex flex-col gap-2 py-3 text-sm first:pt-0 sm:flex-row sm:gap-4">
                      <p className="w-32 shrink-0 font-semibold tabular-nums">{b.time}</p>
                      <div className="flex flex-1 flex-col gap-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{b.title}</p>
                            <p className="text-muted-foreground">
                              {b.customer} · {b.where} ·{" "}
                              <Link href={`/dashboard/orders/${b.sellerOrderId}`} className="underline">
                                {b.orderNumber}
                              </Link>
                            </p>
                            {b.payLater && <p className="text-xs text-muted-foreground">Collect {b.payLater} on the day.</p>}
                          </div>
                          <BookingStatusBadge status={b.statusKey} label={b.status} />
                        </div>
                        {canBook && (b.steps.length > 0 || b.canChange) && <BookingActions side="seller" booking={b} steps={b.steps} isRequest={b.statusKey === "requested"} />}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
