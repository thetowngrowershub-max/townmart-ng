import type { BookingStatus, Prisma } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Pagination } from "@/components/storefront/pagination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/current-user";
import { BOOKING_STATUS_LABELS } from "@/lib/bookings/status";
import { formatBookingTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Bookings" };

const PAGE_SIZE = 30;
const VIEWS = {
  upcoming: "Upcoming",
  waiting: "Waiting for the provider",
  today: "Today",
  problems: "Cancelled or no-show (30 days)",
  all: "All",
} as const;
type View = keyof typeof VIEWS;

/** Every booking on TownMart, for support: who, when, with whom, and its state. Changes happen on the order page. */
export default async function AdminBookingsPage({ searchParams }: { searchParams: Promise<{ view?: string; q?: string; page?: string }> }) {
  const user = await requirePermission("dispute.manage", "/admin/orders/bookings");
  const sp = await searchParams;
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "upcoming";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const now = new Date();
  const lagos = new Date(now.getTime() + 3600_000);
  const dayStart = new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - 3600_000);
  const live: BookingStatus[] = ["requested", "confirmed", "in_progress"];

  const where: Prisma.BookingWhereInput = {
    status: { not: "held" },
    ...(view === "upcoming" ? { startsAt: { gte: now }, status: { in: live } } : {}),
    ...(view === "waiting" ? { status: "requested" } : {}),
    ...(view === "today" ? { startsAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } } : {}),
    ...(view === "problems" ? { status: { in: ["cancelled", "no_show"] }, updatedAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } : {}),
    ...(q
      ? {
          OR: [
            { sellerOrder: { orderNumber: { contains: q, mode: "insensitive" } } },
            { business: { name: { contains: q, mode: "insensitive" } } },
            { service: { title: { contains: q, mode: "insensitive" } } },
            { customer: { email: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const { rows, total } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    rows: await tx.booking.findMany({
      where,
      orderBy: { startsAt: view === "problems" || view === "all" ? "desc" : "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        startsAt: true,
        status: true,
        priceKobo: true,
        atProvider: true,
        cancelReason: true,
        service: { select: { title: true } },
        business: { select: { name: true } },
        sellerOrder: { select: { orderNumber: true } },
        orderItem: { select: { sellerOrder: { select: { order: { select: { customerName: true } } } } } },
      },
    }),
    total: await tx.booking.count({ where }),
  }));
  const qs = (n: number) => new URLSearchParams({ view, ...(q ? { q } : {}), page: String(n) }).toString();
  const tone = (s: BookingStatus) => (s === "cancelled" || s === "no_show" ? "danger" : s === "requested" ? "warning" : s === "completed" ? "success" : "secondary");

  return (
    <>
      <PageHeader
        title="Bookings"
        description={`${total.toLocaleString("en-NG")} booking${total === 1 ? "" : "s"}. Open the order to step in.`}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/orders">
              <ArrowLeft aria-hidden /> Orders & disputes
            </Link>
          </Button>
        }
      />
      <form className="mb-4 flex max-w-xl gap-2" role="search">
        <input type="hidden" name="view" value={view} />
        <Input name="q" defaultValue={q} placeholder="Order number, provider, service or customer email" aria-label="Search bookings" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      <nav aria-label="Booking views" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={`/admin/orders/bookings?view=${v}`}
            aria-current={v === view ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", v === view ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
          >
            {VIEWS[v]}
          </Link>
        ))}
      </nav>
      <Card className="overflow-hidden p-0">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">{q ? "No bookings match." : "Nothing here."}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-muted/40">
                <div className="min-w-0">
                  <Link href={`/admin/orders/${b.sellerOrder.orderNumber}`} className="font-medium hover:underline">
                    {formatBookingTime(b.startsAt)} · {b.service.title}
                  </Link>
                  <p className="text-muted-foreground">
                    {b.business.name} for {b.orderItem.sellerOrder.order.customerName} · {b.atProvider ? "at the provider" : "on site"} · {b.sellerOrder.orderNumber}
                  </p>
                  {b.cancelReason && <p className="text-xs text-muted-foreground">Reason: {b.cancelReason}</p>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatPrice(b.priceKobo)}</span>
                  <Badge variant={tone(b.status)}>{BOOKING_STATUS_LABELS[b.status]}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} href={(n) => `/admin/orders/bookings?${qs(n)}`} />
    </>
  );
}
