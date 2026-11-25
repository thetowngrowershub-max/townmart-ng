import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { RISK_LABELS } from "@/lib/compliance/breach";
import { DPIA_STATUS_LABELS, LAWFUL_BASIS_LABELS } from "@/lib/compliance/labels";
import { formatDate } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "RoPA & DPIAs" };

export default async function RecordsPage() {
  const user = await requirePermission("compliance.manage", "/admin/compliance/records");
  const { activities, processors, dpias } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    activities: await tx.processingActivity.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    processors: await tx.dataProcessor.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] }),
    dpias: await tx.dpiaRecord.findMany({ orderBy: { createdAt: "desc" }, include: { activity: { select: { name: true } } } }),
  }));
  const add = (kind: string, label: string) => (
    <Button asChild variant="outline" size="sm">
      <Link href={`/admin/compliance/records/${kind}/new`}>{label}</Link>
    </Button>
  );

  return (
    <>
      <PageHeader title="RoPA & DPIAs" description="What TownMart does with personal data, who helps, and the risk assessments behind it. Keep these current: the NDPC can ask for them." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Record of processing activities</CardTitle>
              <CardDescription>Each purpose, its lawful basis, the data and how long it&apos;s kept.</CardDescription>
            </div>
            {add("activity", "Add an activity")}
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-xl border text-sm">
              {activities.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.name}</p>
                    <p className="text-muted-foreground">{a.purpose}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {a.dataCategories.join(", ")} · kept: {a.retention}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{LAWFUL_BASIS_LABELS[a.lawfulBasis]}</Badge>
                    <Link href={`/admin/compliance/records/activity/${a.id}`} className="font-medium text-primary hover:underline">
                      Edit
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Processors</CardTitle>
              <CardDescription>Companies that process personal data for TownMart, and where.</CardDescription>
            </div>
            {add("processor", "Add a processor")}
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-xl border text-sm">
              {processors.map((p) => (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {p.name} {!p.active && <Badge variant="outline">Not in use</Badge>}
                    </p>
                    <p className="text-muted-foreground">{p.service}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.location} · {p.dpaSignedAt ? `DPA signed ${formatDate(p.dpaSignedAt)}` : "No DPA recorded"}
                    </p>
                  </div>
                  <Link href={`/admin/compliance/records/processor/${p.id}`} className="font-medium text-primary hover:underline">
                    Edit
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Impact assessments (DPIAs)</CardTitle>
              <CardDescription>For processing likely to be high-risk for people.</CardDescription>
            </div>
            {add("dpia", "Add a DPIA")}
          </CardHeader>
          <CardContent>
            {dpias.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm">
                {dpias.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{d.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.activity?.name ?? "No activity"} · remaining risk {RISK_LABELS[d.residualRisk].toLowerCase()}
                        {d.nextReviewAt ? ` · review by ${formatDate(d.nextReviewAt)}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={d.status === "approved" ? "default" : "secondary"}>{DPIA_STATUS_LABELS[d.status]}</Badge>
                      <Link href={`/admin/compliance/records/dpia/${d.id}`} className="font-medium text-primary hover:underline">
                        Edit
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
