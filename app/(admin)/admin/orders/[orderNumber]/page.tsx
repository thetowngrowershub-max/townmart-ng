import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminRefundDecision, AdminRefundForm } from "@/components/admin/finance-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { RefundList } from "@/components/refunds/refund-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAdminOrder } from "@/lib/admin/finance-view";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const user = await requirePermission("dispute.manage", `/admin/orders/${orderNumber}`);
  const o = await withRls({ scope: "admin", userId: user.id }, (tx) => loadAdminOrder(tx, orderNumber));
  if (!o) notFound();
  const finance = can(user, "finance.manage");

  return (
    <>
      <PageHeader
        title={`Order ${o.orderNumber}`}
        description={`${o.customer} · ${o.email} · placed ${o.placedAt}`}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/orders">
              <ArrowLeft aria-hidden /> Orders
            </Link>
          </Button>
        }
      />
      <dl className="mb-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Payment" value={o.payment} />
        <Stat label="Total" value={o.total} />
        <Stat label="Service fee and VAT" value={o.serviceFee} />
        <Stat label="Refunded" value={o.refunded} />
      </dl>
      <div className="flex flex-col gap-6">
        {o.sellers.map((s) => (
          <Card key={s.id}>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle>{s.shop}</CardTitle>
                <CardDescription>
                  {s.payOnDelivery ? "Pay on delivery" : `Paid ${s.paid} online · ${s.left} left to refund`} · {s.escrow}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {s.dispute && (
                  <Link href={`/admin/disputes/${s.dispute.id}`}>
                    <Badge variant={s.dispute.status === "open" ? "warning" : "secondary"}>{s.dispute.status === "open" ? "Open dispute" : "Dispute decided"}</Badge>
                  </Link>
                )}
                <Badge variant="outline">{s.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{s.items.map((i) => `${i.qty} × ${i.title}`).join(", ")}</p>
              <RefundList refunds={s.refunds} side="admin" />
              {finance &&
                s.waiting.map((w) => (
                  <div key={w.id} id={`refund-${w.id}`} className="rounded-xl border border-warning/40 p-4">
                    <p className="mb-3 text-sm font-semibold">Decide {w.number} for the seller</p>
                    <AdminRefundDecision refundId={w.id} maxNaira={w.maxNaira} items={w.items} />
                  </div>
                ))}
              {finance && !s.payOnDelivery && s.leftNaira !== "0" && s.waiting.length === 0 && <AdminRefundForm sellerOrderId={s.id} leftNaira={s.leftNaira} items={s.items} />}
            </CardContent>
          </Card>
        ))}
        {o.otherRefunds.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Payments returned</CardTitle>
              <CardDescription>Payments that couldn&apos;t be used for the order (wrong amount, paid twice, or paid after the items sold out).</CardDescription>
            </CardHeader>
            <CardContent>
              <RefundList refunds={o.otherRefunds} side="admin" />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
