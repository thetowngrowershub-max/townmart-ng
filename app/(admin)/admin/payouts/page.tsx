import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RetryRefundButton, RunJobButton } from "@/components/admin/finance-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { moneyOverview } from "@/lib/admin/finance-view";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Refunds & payouts" };

export default async function AdminPayoutsPage() {
  const user = await requirePermission("finance.manage", "/admin/payouts");
  const m = await withRls({ scope: "admin", userId: user.id }, (tx) => moneyOverview(tx));

  return (
    <>
      <PageHeader title="Refunds & payouts" description="Where the money is, payouts to sellers, and refunds the payment provider hasn't confirmed." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Refunds that need a look</CardTitle>
              <CardDescription>Check the provider&apos;s dashboard first, then send again.</CardDescription>
            </CardHeader>
            <CardContent>
              {m.failedRefunds.length === 0 ? (
                <p className="text-sm text-muted-foreground">None. Every approved refund has gone through or is on its way.</p>
              ) : (
                <ul className="divide-y">
                  {m.failedRefunds.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm first:pt-0">
                      <div>
                        <Link href={`/admin/orders/${r.orderNumber}`} className="font-medium hover:underline">
                          {r.number} · {r.orderNumber}
                        </Link>
                        <p className="text-danger">{r.error}</p>
                        <p className="text-xs text-muted-foreground">{r.at}</p>
                      </div>
                      <div className="flex items-start gap-3">
                        <span className="font-semibold tabular-nums">{r.amount}</span>
                        <RetryRefundButton refundId={r.id} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>Payouts</CardTitle>
              <CardDescription>The latest 50. Sellers are paid every weekday at 10:00 once their balance reaches the minimum.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {m.payouts.length === 0 ? (
                <p className="px-6 pb-6 text-sm text-muted-foreground">No payouts yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-4 py-3 font-medium">Seller</th>
                        <th scope="col" className="px-4 py-3 font-medium">To</th>
                        <th scope="col" className="px-4 py-3 text-right font-medium">Amount</th>
                        <th scope="col" className="px-4 py-3 font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {m.payouts.map((p) => (
                        <tr key={p.id}>
                          <td className="px-4 py-3">
                            {p.shop}
                            <div className="font-mono text-xs text-muted-foreground">
                              {p.reference} · {p.at}
                            </div>
                          </td>
                          <td className="px-4 py-3">{p.bank}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{p.amount}</td>
                          <td className="px-4 py-3">
                            <Badge variant={p.tone}>{p.status}</Badge>
                            {p.failureReason && <div className="text-xs text-danger">{p.failureReason}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Where the money is</CardTitle>
              <CardDescription className="flex items-center gap-1">
                {m.trialBalanceOk ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <AlertTriangle className="size-4 text-danger" aria-hidden />}
                {m.trialBalanceOk ? "The ledger balances." : "The ledger doesn't balance. Tell engineering now."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-1 text-sm">
                {m.platform.map((p) => (
                  <div key={p.label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{p.label}</dt>
                    <dd className="tabular-nums">{p.balance}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Run now</CardTitle>
              <CardDescription>These run on their own; use these after fixing a problem. {m.escrowDue} order{m.escrowDue === 1 ? " is" : "s are"} due for release.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <RunJobButton job="escrow" label="Release due escrow" />
              <RunJobButton job="payouts" label="Run today's payouts" />
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
