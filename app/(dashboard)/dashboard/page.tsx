import { AlertTriangle, Package, Plus, Star, Store, Wrench } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { formatPrice } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/orders/view";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";

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
      where: { businessId: id },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, orderNumber: true, payOnDelivery: true, status: true, sellerNetKobo: true, deliveryMethod: true, createdAt: true, _count: { select: { items: true } } },
    });
    return { activeProducts, draftProducts, activeServices, business, low, orders };
  });
  const note = STATUS_NOTE[ctx.business.status];

  const cards = [
    { label: "Live products", value: stats.activeProducts, icon: Package, href: "/dashboard/products?status=active" },
    { label: "Draft products", value: stats.draftProducts, icon: Package, href: "/dashboard/products?status=draft" },
    { label: "Live services", value: stats.activeServices, icon: Wrench, href: "/dashboard/services" },
    { label: "Low-stock items", value: stats.low.length, icon: AlertTriangle, href: "/dashboard/products?stock=low" },
    {
      label: "Rating",
      value: stats.business.ratingCount ? `${Number(stats.business.ratingAvg).toFixed(1)} (${stats.business.ratingCount})` : "No reviews yet",
      icon: Star,
      href: undefined,
    },
  ];

  return (
    <>
      <PageHeader
        title={ctx.business.name}
        description="Your listings, recent orders and stock at a glance."
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
            <CardDescription>Full order management (packing, dispatch and delivery updates) arrives in the next release.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No orders yet. They appear here as soon as a customer pays or chooses pay on delivery.</p>
            ) : (
              <ul className="divide-y text-sm">
                {stats.orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <span>
                      <span className="font-medium">{o.orderNumber}</span>{" "}
                      <span className="text-muted-foreground">
                        · {o._count.items} item{o._count.items === 1 ? "" : "s"} · {o.deliveryMethod === "pickup" ? "Pickup" : "Delivery"} · {formatDateTime(o.createdAt)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant={o.status === "cancelled" ? "secondary" : o.status === "pending_payment" ? "warning" : "default"}>
                        {o.payOnDelivery && o.status === "processing" ? "Pay on delivery" : ORDER_STATUS_LABELS[o.status]}
                      </Badge>
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
