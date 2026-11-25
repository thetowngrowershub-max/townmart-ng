import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { RefundList } from "@/components/refunds/refund-list";
import { SellerRefundDecision } from "@/components/refunds/seller-refund-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/lib/authz";
import { koboToNairaString } from "@/lib/money";
import { loadSellerRefund } from "@/lib/refunds/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Refund request" };

export default async function SellerRefundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/refunds/${id}`, "order.read");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await withSellerRls(ctx, (tx) => loadSellerRefund(tx, ctx.business.id, id));
  if (!d) notFound();
  const canManage = can(ctx.user, "order.manage", { businessId: ctx.business.id });

  return (
    <>
      <PageHeader
        title={`Refund ${d.refund.number}`}
        description={`Order ${d.orderNumber} · ${d.customer} paid ${d.paid} online · ${d.left} not yet refunded`}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/dashboard/refunds">
              <ArrowLeft aria-hidden /> Refunds
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <RefundList refunds={[d.refund]} side="seller" />
          <p className="text-sm">
            <Link href={`/dashboard/orders/${d.sellerOrderId}`} className="text-primary underline">
              Open the order
            </Link>{" "}
            to see the items, history and your messages with the customer.
            {d.dispute && (
              <>
                {" "}
                <Link href={`/dashboard/disputes/${d.dispute.id}`} className="text-primary underline">
                  {d.dispute.status === "open" ? "TownMart is looking into this order." : "See TownMart's decision."}
                </Link>
              </>
            )}
          </p>
        </div>
        {d.refund.status === "requested" && (
          <Card>
            <CardHeader>
              <CardTitle>Your answer</CardTitle>
              <CardDescription>{d.refund.respondBy ? `Answer by ${d.refund.respondBy}. After that, TownMart decides.` : "TownMart may decide if this isn't answered."}</CardDescription>
            </CardHeader>
            <CardContent>
              {canManage ? (
                <SellerRefundDecision refundId={d.refund.id} maxNaira={koboToNairaString(BigInt(d.maxKobo))} items={d.items} />
              ) : (
                <p className="text-sm text-muted-foreground">You need order access to answer refund requests.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
