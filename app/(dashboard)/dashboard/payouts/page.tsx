import { Download, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RequestPayout } from "@/components/refunds/request-payout";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { loadSellerPayouts } from "@/lib/payouts/seller-view";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Payouts" };

const STATUS_VARIANT = { pending: "info", processing: "info", paid: "success", failed: "danger" } as const;

export default async function SellerPayoutsPage() {
  const ctx = await requireSellerPage("/dashboard/payouts", "payout.manage");
  const v = await withSellerRls(ctx, (tx) => loadSellerPayouts(tx, ctx.business.id));
  const canPay = v.approved && !!v.bank?.ready && !v.inFlight && BigInt(v.availableKobo) > 0n;

  return (
    <>
      <PageHeader title="Payouts" description="Money from online orders is held until delivery, then released to your balance after the hold period. Your balance is paid to your bank every weekday morning." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Available to pay out</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{v.available}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Paid automatically on weekdays once it reaches {v.minimum}.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Held until delivery</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{v.escrow}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{v.nextRelease ? `About ${v.nextRelease.amount} is due to be released on ${v.nextRelease.at}.` : "Nothing waiting to be released."}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bank account</CardDescription>
            <CardTitle className="text-lg">{v.bank ? `${v.bank.name} ••••${v.bank.last4}` : "Not added"}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
            {v.bank ? <p>{v.bank.accountName}</p> : null}
            {(!v.bank || !v.bank.ready) && (
              <Link href="/dashboard/settings" className="text-primary underline">
                {v.bank ? "Verify it in Store settings" : "Add it in Store settings"}
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>Payout history</CardTitle>
          </CardHeader>
          <CardContent>
            {v.payouts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payouts yet.</p>
            ) : (
              <ul className="divide-y">
                {v.payouts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0">
                    <div>
                      <p className="font-medium tabular-nums">{p.amount}</p>
                      <p className="text-muted-foreground">
                        {p.bank} · {p.createdAt} · <span className="font-mono text-xs">{p.reference}</span>
                      </p>
                      {p.failureReason && <p className="text-xs text-danger">{p.failureReason}</p>}
                    </div>
                    <Badge variant={STATUS_VARIANT[p.status]}>{p.paidAt ? `Paid ${p.paidAt}` : p.statusLabel}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Pay out now</CardTitle>
              <CardDescription>Don&apos;t want to wait for tomorrow&apos;s run? Send your whole available balance now.</CardDescription>
            </CardHeader>
            <CardContent>
              {!v.approved ? (
                <Alert variant="info">Payouts start once your store is approved.</Alert>
              ) : v.inFlight ? (
                <Alert variant="info">A payout is on its way. You can ask for the next one when it lands.</Alert>
              ) : !v.bank?.ready ? (
                <Alert variant="info">Add and verify your bank account in Store settings first.</Alert>
              ) : BigInt(v.availableKobo) <= 0n ? (
                <p className="text-sm text-muted-foreground">Nothing to pay out yet. Money arrives here once orders are delivered and the hold period ends.</p>
              ) : (
                <RequestPayout disabled={!canPay} amount={v.available} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>This month</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-1 text-sm">
                <Row label="Online sales (your share)" value={v.thisMonth.sales} />
                <Row label="TownMart commission on released orders" value={v.thisMonth.commission} />
                <Row label="Refunds" value={v.thisMonth.refunds} />
                <Row label="Paid to your bank" value={v.thisMonth.paidOut} />
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Statements</CardTitle>
              <CardDescription>Every movement on your balance, month by month.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2 text-sm">
                {v.months.map((m) => (
                  <li key={m.value} className="flex items-center justify-between gap-2">
                    <span>{m.label}</span>
                    <span className="flex gap-1">
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/dashboard/payouts/statement?month=${m.value}`}>
                          <FileText aria-hidden /> View
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant="ghost">
                        <a href={`/api/seller/statement?month=${m.value}`} download>
                          <Download aria-hidden /> CSV
                        </a>
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
