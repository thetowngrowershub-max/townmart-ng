import { AlertTriangle, CalendarCheck, ClipboardList, Package, Plus, Star, Store, TrendingUp, Wallet, Wrench } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { OrderStatusBadge } from "@/components/orders/order-status-badge";
import { SalesChart } from "@/components/seller/sales-chart";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { formatPrice } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/orders/view";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { sellerKpis } from "@/lib/seller/overview";

const STATUS_NOTE: Record<string, { variant: "info" | "warning" | "danger" | "success"; text: string; link?: { href: string; label: string } }> = {
  draft: { variant: "warning", text: "Your seller application isn't finished. Listings stay hidden until you're approved.", link: { href: "/sell/onboarding", label: "Continue application" } },
  pending: { variant: "info", text: "Your application is waiting for review. Active listings go live as soon as you're approved." },
  under_review: { variant: "info", text: "We're reviewing your application. Active listings go live as soon as you're approved." },
  rejected: { variant: "danger", text: "We need some changes before approving your store.", link: { href: "/sell/onboarding", label: "See what to fix" } },
  suspended: { variant: "danger", text: "Your store is suspended and its listings are hidden. Check your email for details." },
};

export default async function DashboardPage() {
  await requirePermission("dashboard.access", "/dashboard");
  const ctx = await getSellerContext();
  if (!ctx) {
    return (
      <>
        <PageHeader title="Overview" />
        <Card>
          <CardHeader className="flex-row items-center gap-4">
            <Store className="size-8 text-primary" aria-hidden />
            <div>
              <CardTitle>You haven&apos;t set up a store yet</CardTitle>
              <CardDescription>Tell us about your business to start selling.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/sell/onboarding">Set up your store</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  const stats = await withSellerRls(ctx, async (tx) => {
    const id = ctx.business.id;
    const activeProducts = await tx.product.count({ where: { businessId: id, deletedAt: null, status: "active" } });
    const draftProducts = await tx.product.count({ where: { businessId: id, deletedAt: null, status: "draft" } });
    const activeServices = await tx.service.count({ where: { businessId: id, deletedAt: null, status: "active" } });
    const business = await tx.business.findUniqueOrThrow({ where: { id }, select: { ratingAvg: true, ratingCount: true } });
    const low = await tx.$queryRaw<{ id: string; title: string; sku: string; stock_qty: string; low_stock_threshold: string }[]>`
        SELECT p.id, p.title, v.sku, v.stock_qty::text, v.low_stock_threshold::text
          FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.business_id = ${id}::uuid AND p.deleted_at IS NULL AND p.track_inventory
           AND v.stock_qty <= v.low_stock_threshold
         ORDER BY v.stock_qty ASC LIMIT 8`;
    // RLS limits this to the seller's own part of each order.
    const orders = await tx.sellerOrder.findMany({
      where: { businessId: id, status: { not: "pending_payment" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, orderNumber: true, payOnDelivery: true, status: true, sellerNetKobo: true, deliveryMethod: true, createdAt: true, _count: { select: { items: true } } },
    });
    const kpis = await sellerKpis(tx, id);
    return { activeProducts, draftProducts, activeServices, business, low, orders, kpis };
  });
  const note = STATUS_NOTE[ctx.business.status];

  const k = stats.kpis;
  const kpiCards = [
    { label: "Today's sales", value: formatPrice(k.todayKobo), sub: `${k.todayOrders} order${k.todayOrders === 1 ? "" : "s"}, after commission`, icon: TrendingUp, href: "/dashboard/orders?show=all" },
    { label: "Orders to handle", value: String(k.pendingOrders), sub: "Paid or pay on delivery, not yet sent", icon: ClipboardList, href: "/dashboard/orders" },
    { label: "Bookings this week", value: String(k.upcomingBookings), sub: "Requested or confirmed", icon: CalendarCheck, href: "/dashboard/bookings" },
    { label: "Payout balance", value: formatPrice(k.availableKobo), sub: `${formatPrice(k.escrowKobo)} held until orders complete`, icon: Wallet, href: undefined },
    {
      label: "Rating",
      value: stats.business.ratingCount ? Number(stats.business.ratingAvg).toFixed(1) : "–",
      sub: stats.business.ratingCount ? `${stats.business.ratingCount} review${stats.business.ratingCount === 1 ? "" : "s"}` : "No reviews yet",
      icon: Star,
      href: "/dashboard/reviews",
    },
  ];
  const cards = [
    { label: "Live products", value: stats.activeProducts, icon: Package, href: "/dashboard/products?status=active" },
    { label: "Draft products", value: stats.draftProducts, icon: Package, href: "/dashboard/products?status=draft" },
    { label: "Live services", value: stats.activeServices, icon: Wrench, href: "/dashboard/services" },
    { label: "Low-stock items", value: stats.low.length, icon: AlertTriangle, href: "/dashboard/products?stock=low" },
  ];

  return (
    <>
      <PageHeader
        title={ctx.business.name}
        description="Sales, orders and bookings at a glance. Figures are your earnings after TownMart commission."
        actions={
          <div className="flex gap-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/services/new">
                <Plus aria-hidden /> Service
              </Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard/products/new">
                <Plus aria-hidden /> Product
              </Link>
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        {note && (
          <Alert variant={note.variant}>
            {note.text} {note.link && <Link href={note.link.href}>{note.link.label}</Link>}
          </Alert>
        )}
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {kpiCards.map(({ label, value, sub, icon: Icon, href }) => {
            const body = (
              <Card className="h-full p-5">
                <Icon className="size-5 text-primary" aria-hidden />
                <p className="mt-2 text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 font-heading text-2xl font-bold tabular-nums">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{sub}</p>
              </Card>
            );
            return <li key={label}>{href ? <Link href={href} className="block h-full rounded-2xl hover:ring-2 hover:ring-primary/30">{body}</Link> : body}</li>;
          })}
        </ul>
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <Card>
            <CardHeader>
              <CardTitle>Earnings, last 14 days</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <SalesChart days={k.daily} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Top products</CardTitle>
              <CardDescription>Last 30 days, by sales</CardDescription>
            </CardHeader>
            <CardContent>
              {k.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No product sales in the last 30 days.</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {k.topProducts.map((t, i) => (
                    <li key={t.productId} className="flex items-center gap-3">
                      <span className="w-4 text-muted-foreground tabular-nums">{i + 1}</span>
                      <Link href={`/dashboard/products/${t.productId}`} className="min-w-0 flex-1 truncate hover:underline">
                        {t.title}
                      </Link>
                      <span className="text-muted-foreground tabular-nums">× {Number(t.qty)}</span>
                      <span className="font-semibold tabular-nums">{formatPrice(t.kobo)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {cards.map(({ label, value, icon: Icon, href }) => {
            const body = (
              <Card className="h-full p-5">
                <Icon className="size-5 text-primary" aria-hidden />
                <p className="mt-2 text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 font-heading text-2xl font-bold">{value}</p>
              </Card>
            );
            return <li key={label}>{href ? <Link href={href} className="block h-full rounded-2xl hover:ring-2 hover:ring-primary/30">{body}</Link> : body}</li>;
          })}
        </ul>
        <Card>
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            <CardDescription>
              <Link href="/dashboard/orders" className="text-primary underline">
                All orders
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet. They appear here as soon as a customer pays or chooses pay on delivery.</p>
            ) : (
              <ul className="divide-y text-sm">
                {stats.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>
                      <Link href={`/dashboard/orders/${o.id}`} className="font-medium hover:underline">
                        {o.orderNumber}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        · {o._count.items} item{o._count.items === 1 ? "" : "s"} · {o.deliveryMethod === "pickup" ? "Pickup" : o.deliveryMethod === "none" ? "Booking" : "Delivery"} · {formatDateTime(o.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <OrderStatusBadge status={o.status} label={ORDER_STATUS_LABELS[o.status]} />
                      <span className="font-semibold tabular-nums" title="Your earnings after commission">
                        {formatPrice(o.sellerNetKobo)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {stats.low.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Running low</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {stats.low.map((v) => (
                  <li key={v.sku} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/dashboard/products/${v.id}/stock`} className="font-medium hover:underline">
                      {v.title} <span className="font-mono text-xs text-muted-foreground">{v.sku}</span>
                    </Link>
                    <span className={Number(v.stock_qty) <= 0 ? "font-semibold text-danger" : "font-medium"}>
                      {Number(v.stock_qty)} left (alert at {Number(v.low_stock_threshold)})
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
