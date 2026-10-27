import type { Metadata } from "next";
import Link from "next/link";
import { NdpcCountdown } from "@/components/compliance/ndpc-countdown";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { RISK_LABELS } from "@/lib/compliance/breach";
import { complianceOverview } from "@/lib/compliance/view";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Compliance centre" };

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | "warning" }) {
  return (
    <div className="rounded-xl border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={tone === "danger" && value > 0 ? "text-2xl font-bold text-danger" : tone === "warning" && value > 0 ? "text-2xl font-bold text-warning-foreground" : "text-2xl font-bold"}>{value}</p>
    </div>
  );
}

export default async function ComplianceOverviewPage() {
  const user = await requirePermission("compliance.manage", "/admin/compliance");
  const o = await withRls({ scope: "admin", userId: user.id }, (tx) => complianceOverview(tx));
  const consentTotal = o.consent.all + o.consent.none + o.consent.some;

  return (
    <>
      <PageHeader title="Compliance centre" description="Data requests, breaches and records under the Nigeria Data Protection Act 2023." />
      {(o.companyMissing > 0 || o.templatePages > 0) && (
        <Alert variant="warning" className="mb-6">
          {o.templatePages > 0 && `${o.templatePages} legal pages are still templates awaiting review by a Nigerian lawyer or DPO. `}
          {o.companyMissing > 0 && `${o.companyMissing} company details used in the legal pages aren't filled in yet. `}
          <Link href="/admin/compliance/legal">Open legal pages</Link>
        </Alert>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Data requests</CardTitle>
            <CardDescription>Requests must be answered by their deadline.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Open" value={o.requests.open} />
              <Stat label="Overdue" value={o.requests.overdue} tone="danger" />
              <Stat label="Due in 7 days" value={o.requests.dueSoon} tone="warning" />
              <Stat label="Awaiting email check" value={o.requests.unverified} />
            </div>
            <Button asChild variant="outline" className="self-start">
              <Link href="/admin/compliance/requests">Open the queue</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Breaches</CardTitle>
            <CardDescription>Tell the NDPC within 72 hours of becoming aware.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {o.breaches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open breaches.</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm">
                {o.breaches.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <Link href={`/admin/compliance/breaches/${b.id}`} className="font-medium hover:underline">
                      {b.reference} · {b.title}
                    </Link>
                    <span className="flex items-center gap-2">
                      <Badge variant={b.risk === "high" ? "danger" : "secondary"}>{RISK_LABELS[b.risk]} risk</Badge>
                      <NdpcCountdown deadline={b.clock.deadline.toISOString()} notifiedAt={b.clock.state === "notified" ? b.clock.notifiedAt.toISOString() : null} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="outline" className="self-start">
              <Link href="/admin/compliance/breaches/new">Log a breach</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Cookie choices, last 30 days</CardTitle>
            <CardDescription>How visitors answered the cookie banner.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <Stat label="Accepted all" value={o.consent.all} />
            <Stat label="Rejected optional" value={o.consent.none} />
            <Stat label="Chose some" value={o.consent.some} />
            {consentTotal === 0 && <p className="col-span-3 text-sm text-muted-foreground">No choices recorded yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
