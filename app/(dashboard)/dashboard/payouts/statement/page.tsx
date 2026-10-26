import { ArrowLeft, Download } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/orders/print-button";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { formatPrice } from "@/lib/money";
import { buildStatement, lagosMonth } from "@/lib/payouts/statement";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { statementMonthSchema } from "@/lib/validation/refunds";

export const metadata: Metadata = { title: "Statement" };

const signed = (k: bigint) => (k === 0n ? "" : k > 0n ? formatPrice(k) : `−${formatPrice(-k)}`);

export default async function StatementPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/payouts/statement", "payout.manage");
  const month = (await searchParams).month ?? lagosMonth(new Date());
  if (!statementMonthSchema.safeParse(month).success) notFound();
  const s = await withSellerRls(ctx, (tx) => buildStatement(tx, ctx.business.id, month));
  if (!s) notFound();
  const label = new Intl.DateTimeFormat("en-NG", { month: "long", year: "numeric", timeZone: "Africa/Lagos" }).format(s.from);

  return (
    <>
      <PageHeader
        title={`Statement: ${label}`}
        description={`${ctx.business.name} · all times Lagos`}
        actions={
          <div className="flex gap-2 print:hidden">
            <Button asChild size="sm" variant="ghost">
              <Link href="/dashboard/payouts">
                <ArrowLeft aria-hidden /> Payouts
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <a href={`/api/seller/statement?month=${month}`} download>
                <Download aria-hidden /> CSV
              </a>
            </Button>
            <PrintButton label="Print or save as PDF" />
          </div>
        }
      />
      <dl className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Opening balance" value={formatPrice(s.opening.availableKobo)} hint={`${formatPrice(s.opening.escrowKobo)} held`} />
        <Stat label="Online sales (your share)" value={formatPrice(s.totals.salesKobo)} hint={`${formatPrice(s.totals.commissionKobo)} commission on released orders`} />
        <Stat label="Refunds and payouts" value={`−${formatPrice(s.totals.refundsKobo + s.totals.payoutsKobo)}`} hint={`${formatPrice(s.totals.payoutsKobo)} paid to your bank`} />
        <Stat label="Closing balance" value={formatPrice(s.closing.availableKobo)} hint={`${formatPrice(s.closing.escrowKobo)} held`} />
      </dl>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Date</th>
                <th scope="col" className="px-4 py-3 font-medium">What</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Held</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Available</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {s.lines.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    Nothing moved this month.
                  </td>
                </tr>
              ) : (
                s.lines.map((l, n) => (
                  <tr key={n}>
                    <td className="whitespace-nowrap px-4 py-2">{formatDateTime(l.at)}</td>
                    <td className="px-4 py-2">
                      {l.label}
                      {l.memo && <div className="text-xs text-muted-foreground">{l.memo}</div>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{signed(l.escrowKobo)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{signed(l.availableKobo)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatPrice(l.balanceKobo)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}
