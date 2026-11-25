import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RequestPayout } from "@/components/refunds/request-payout";
import { PayoutForm } from "@/components/seller/onboarding/payout-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls, withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { bankVerifier, type Bank } from "@/lib/payments/banks";
import { getPoolRider } from "@/lib/riders/pool";
import { loadRiderWallet } from "@/lib/wallets/rider";

export const metadata: Metadata = { title: "Wallet", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** A TownMart pool rider's earnings, bank account and payouts. */
export default async function RiderWalletPage() {
  const user = await requirePermission("account.access", "/rider/wallet");
  const rider = await withRls({ userId: user.id }, (tx) => getPoolRider(tx, user.id));
  if (!rider) {
    return (
      <>
        <PageHeader title="Wallet" description="Your delivery earnings and payouts." />
        <Alert variant="info">
          Your wallet opens once TownMart approves you as a rider. <Link href="/rider" className="underline">See your application</Link>.
        </Alert>
      </>
    );
  }
  const v = await withSystemContext((tx) => loadRiderWallet(tx, rider.id));
  let banks: Bank[] = [];
  try {
    banks = await bankVerifier().listBanks();
  } catch (err) {
    logger.error({ err }, "bank list failed on rider wallet");
  }
  const canPay = !!v.bank?.ready && !v.inFlight && BigInt(v.balanceKobo) > 0n;

  return (
    <>
      <PageHeader title="Wallet" description="You earn your share of the delivery fee on every TownMart delivery, as soon as the customer has their order." />
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>In your wallet</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{v.balance}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Paid to your bank on weekdays once it reaches {v.minimum}, or ask for it any time.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Earned this month</CardDescription>
            <CardTitle className="text-3xl tabular-nums">{v.thisMonth.earned}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {v.thisMonth.deliveries} deliver{v.thisMonth.deliveries === 1 ? "y" : "ies"} · {v.thisMonth.paidOut} paid to your bank
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Bank account</CardDescription>
            <CardTitle className="text-lg">{v.bank ? `${v.bank.name} ••••${v.bank.last4}` : "Not added"}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">{v.bank ? v.bank.accountName : "Add it below to get paid."}</CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Earnings and payouts</CardTitle>
              <CardDescription>The latest 50 movements in your wallet.</CardDescription>
            </CardHeader>
            <CardContent>
              {v.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing yet. Your pay for each delivery shows here once it&apos;s delivered.</p>
              ) : (
                <ul className="divide-y">
                  {v.entries.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-3 text-sm first:pt-0">
                      <div>
                        <p className="font-medium">{e.label}</p>
                        <p className="text-muted-foreground">
                          {e.memo ? `${e.memo} · ` : ""}
                          {e.at}
                        </p>
                      </div>
                      <span className={`font-semibold tabular-nums ${e.credit ? "text-success" : ""}`}>
                        {e.credit ? "+" : "−"}
                        {e.amount}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
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
                      <Badge variant={p.tone}>{p.paidAt ? `Paid ${p.paidAt}` : p.statusLabel}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Get paid now</CardTitle>
              <CardDescription>
                Ask for your whole wallet balance.{v.needsApproval ? " TownMart checks each payout first, usually within a working day." : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {v.inFlight ? (
                <Alert variant="info">A payout is waiting for approval or on its way. We&apos;ll text you when it&apos;s sent.</Alert>
              ) : !v.bank?.ready ? (
                <Alert variant="info">{v.bank ? "Save your bank account again below so we can pay it." : "Add your bank account below first."}</Alert>
              ) : BigInt(v.balanceKobo) <= 0n ? (
                <p className="text-sm text-muted-foreground">Nothing to pay out yet.</p>
              ) : (
                <RequestPayout who="rider" disabled={!canPay} amount={v.balance} approval={v.needsApproval} />
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{v.bank ? "Change bank account" : "Add your bank account"}</CardTitle>
              <CardDescription>Payouts go to a Nigerian bank account in your own name.</CardDescription>
            </CardHeader>
            <CardContent>
              {banks.length === 0 ? (
                <Alert variant="danger">We couldn&apos;t load the list of banks. Please try again shortly.</Alert>
              ) : (
                <PayoutForm who="rider" banks={banks} current={v.bank ? { bankName: v.bank.name, accountName: v.bank.accountName, last4: v.bank.last4 } : null} next="/rider/wallet" />
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </>
  );
}
