import type { Metadata } from "next";
import Link from "next/link";
import { BookingActions } from "@/components/bookings/booking-actions";
import { PageHeader } from "@/components/layout/app-shell";
import { BookingStatusBadge } from "@/components/orders/order-status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { customerBookings } from "@/lib/bookings/lists";
import { withRls } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "My bookings" };

export default async function MyBookingsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePermission("account.access", "/account/bookings");
  const show = (await searchParams).show === "past" ? "past" : "upcoming";
  const rows = await withRls({ userId: user.id }, (tx) => customerBookings(tx, user.id, show));

  return (
    <>
      <PageHeader title="Bookings" description="Services you've booked. You can move or cancel a booking until it starts." />
      <nav aria-label="Booking filters" className="mb-4 flex gap-2">
        {(["upcoming", "past"] as const).map((f) => (
          <Link
            key={f}
            href={f === "upcoming" ? "/account/bookings" : "/account/bookings?show=past"}
            aria-current={f === show ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", f === show ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
          >
            {f === "upcoming" ? "Coming up" : "Past"}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="text-muted-foreground">{show === "upcoming" ? "No bookings coming up." : "No past bookings."}</p>
            <Button asChild>
              <Link href="/c/services">Find a service</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((b) => (
            <li key={b.id}>
              <Card>
                <CardContent className="flex flex-col gap-2 pt-6 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{b.title}</p>
                      <p className="text-muted-foreground">with {b.seller}</p>
                    </div>
                    <BookingStatusBadge status={b.statusKey} label={b.status} />
                  </div>
                  <p>
                    <span className="font-medium">{b.when}</span> <span className="text-muted-foreground">· {b.where}</span>
                  </p>
                  {b.payLater && <p className="text-xs text-muted-foreground">Pay {b.payLater} to the provider on the day.</p>}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/account/orders/${b.orderNumber}`}>Order {b.orderNumber}</Link>
                    </Button>
                    {b.canReview && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/account/reviews/new?item=${b.orderItemId}`}>Write a review</Link>
                      </Button>
                    )}
                  </div>
                  {b.canChange && <BookingActions side="customer" orderNumber={b.orderNumber} booking={b} />}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
