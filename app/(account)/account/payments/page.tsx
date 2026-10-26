import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { PROVIDER_LABELS } from "@/lib/orders/view";

export const metadata: Metadata = { title: "Payment history" };

const STATE: Record<string, { label: string; variant: "default" | "secondary" | "warning" | "danger" }> = {
  initiated: { label: "Started", variant: "warning" },
  success: { label: "Paid", variant: "default" },
  failed: { label: "Failed", variant: "danger" },
  abandoned: { label: "Not completed", variant: "secondary" },
  reversed: { label: "Reversed", variant: "secondary" },
};

export default async function PaymentsPage() {
  const user = await requirePermission("account.access", "/account/payments");
  // RLS shows payments for the shopper's own orders only.
  const payments = await withRls({ userId: user.id }, (tx) =>
    tx.payment.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { order: { select: { orderNumber: true } } } }),
  );
  return (
    <>
      <PageHeader title="Payment history" description="Every payment attempt on your orders. TownMart never stores card details." />
      {payments.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-muted-foreground">No payments yet.</CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Order</th>
                <th className="p-3 font-medium">Method</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {payments.map((p) => (
                <tr key={p.id}>
                  <td className="p-3 whitespace-nowrap">{formatDateTime(p.paidAt ?? p.createdAt)}</td>
                  <td className="p-3">
                    <Link href={`/account/orders/${p.order.orderNumber}`} className="text-primary hover:underline">
                      {p.order.orderNumber}
                    </Link>
                  </td>
                  <td className="p-3">
                    {PROVIDER_LABELS[p.provider]}
                    {p.channel && <span className="text-muted-foreground"> ({p.channel.replace(/_/g, " ")})</span>}
                  </td>
                  <td className="p-3">
                    <Badge variant={STATE[p.status]?.variant ?? "secondary"}>{STATE[p.status]?.label ?? p.status}</Badge>
                  </td>
                  <td className="p-3 text-right tabular-nums">{formatPrice(p.amountKobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
