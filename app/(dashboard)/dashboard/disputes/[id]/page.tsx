import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { RefundList } from "@/components/refunds/refund-list";
import { SellerDispute } from "@/components/refunds/seller-dispute";
import { DisputeThread } from "@/components/refunds/dispute-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import type { FulfilmentContact } from "@/lib/orders/place";
import { loadDispute } from "@/lib/refunds/view";
import { sellerOrderRefunds } from "@/lib/refunds/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Dispute" };

export default async function SellerDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/disputes/${id}`, "order.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withSellerRls(ctx, async (tx) => {
    const row = await tx.dispute.findFirst({ where: { id, businessId: ctx.business.id }, select: { sellerOrderId: true, sellerOrder: { select: { orderNumber: true, fulfilmentContact: true } } } });
    if (!row) return null;
    return { row: { sellerOrderId: row.sellerOrderId, order: { orderNumber: row.sellerOrder.orderNumber, customerName: (row.sellerOrder.fulfilmentContact as FulfilmentContact | null)?.name ?? "The customer" } }, dispute: (await loadDispute(tx, { id }))!, refunds: await sellerOrderRefunds(tx, ctx.business.id, row.sellerOrderId) };
  });
  if (!data) notFound();
  const { row, dispute, refunds } = data;
  const canManage = can(ctx.user, "order.manage", { businessId: ctx.business.id });

  return (
    <>
      <PageHeader
        title={`Dispute on order ${row.order.orderNumber}`}
        description={`${row.order.customerName} asked TownMart to decide on ${dispute.openedAt}.`}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/dashboard/refunds?show=disputes">
              <ArrowLeft aria-hidden /> Disputes
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>{dispute.status === "open" ? "Give your side" : "Decision"}</CardTitle>
            <CardDescription>The customer, you and TownMart all see this thread. Keep to the facts and add anything that helps, like when and how you sent the order.</CardDescription>
          </CardHeader>
          <CardContent>{canManage && dispute.status === "open" ? <SellerDispute dispute={dispute} /> : <DisputeThread dispute={dispute} me="seller" />}</CardContent>
        </Card>
        <aside className="flex flex-col gap-4">
          <Link href={`/dashboard/orders/${row.sellerOrderId}`} className="text-sm text-primary underline">
            Open the order
          </Link>
          <RefundList refunds={refunds.refunds} side="seller" />
        </aside>
      </div>
    </>
  );
}
