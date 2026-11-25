import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminDispute, ResolveDispute } from "@/components/admin/finance-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { RefundList } from "@/components/refunds/refund-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadAdminDispute } from "@/lib/admin/finance-view";
import { logPersonalDataView } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { requestMeta } from "@/lib/request";

export const metadata: Metadata = { title: "Dispute" };

export default async function AdminDisputePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("dispute.manage", `/admin/disputes/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const meta = await requestMeta();
  const d = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const d = await loadAdminDispute(tx, id);
    if (d) await logPersonalDataView(tx, { actorUserId: user.id, entityType: "dispute", entityId: id, fields: ["customer name", "messages", "evidence"], ipHash: meta.ipHash });
    return d;
  });
  if (!d) notFound();

  return (
    <>
      <PageHeader
        title={`Dispute: ${d.customer} and ${d.shop}`}
        description={`Order ${d.orderNumber} · opened ${d.dispute.openedAt}${d.dispute.refundNumber ? ` about refund ${d.dispute.refundNumber}` : ""}`}
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/orders?tab=disputes">
              <ArrowLeft aria-hidden /> Disputes
            </Link>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Thread</CardTitle>
              <CardDescription>Both sides see everything written here.</CardDescription>
            </CardHeader>
            <CardContent>
              <AdminDispute dispute={d.dispute} />
            </CardContent>
          </Card>
          {d.refunds.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Refunds on this order</h2>
              <RefundList refunds={d.refunds} side="admin" />
            </section>
          )}
        </div>
        <aside className="flex flex-col gap-4">
          <Link href={`/admin/orders/${d.orderNumber}`} className="text-sm text-primary underline">
            Open the whole order
          </Link>
          {d.dispute.status === "open" && (
            <Card>
              <CardHeader>
                <CardTitle>Decide</CardTitle>
                <CardDescription>{d.payOnDelivery ? "Paid in cash to the seller." : `${d.left} can still be refunded.`}</CardDescription>
              </CardHeader>
              <CardContent>
                <ResolveDispute disputeId={id} left={d.left} payOnDelivery={d.payOnDelivery} />
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
