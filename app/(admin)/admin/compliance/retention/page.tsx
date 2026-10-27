import type { Metadata } from "next";
import { RetentionForm } from "@/components/compliance/settings-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { getRetention, RETENTION_DEFAULTS, RETENTION_KEYS } from "@/lib/compliance/retention";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Retention" };

const JOBS = ["retention.carts", "retention.unverified-accounts", "retention.logs", "retention.anonymise-accounts", "retention.exports", "retention.unverified-requests"];

export default async function RetentionPage() {
  const user = await requirePermission("compliance.manage", "/admin/compliance/retention");
  const { periods, runs } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    periods: await getRetention(tx),
    runs: await tx.$queryRaw<{ job_name: string; status: string; finished_at: Date | null; meta: unknown }[]>`
      SELECT DISTINCT ON (job_name) job_name, status::text, finished_at, meta FROM job_runs
       WHERE job_name = ANY(${JOBS}) ORDER BY job_name, started_at DESC`,
  }));
  const lastRun = new Map(runs.map((r) => [r.job_name, r]));

  return (
    <>
      <PageHeader title="Retention" description="How long TownMart keeps each kind of data. The worker applies these every night (Lagos time)." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Retention periods</CardTitle>
            <CardDescription>Order, payment and refund records are kept for six years by law and aren&apos;t set here.</CardDescription>
          </CardHeader>
          <CardContent>
            <RetentionForm fields={RETENTION_KEYS.map((k) => ({ key: k, label: RETENTION_DEFAULTS[k].label, hint: RETENTION_DEFAULTS[k].description, value: String(periods[k]) }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Last runs</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {JOBS.map((j) => {
                const r = lastRun.get(j);
                return (
                  <li key={j}>
                    <p className="font-medium">{j.replace("retention.", "").replace(/-/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">{r ? `${r.status}${r.finished_at ? `, ${formatDateTime(r.finished_at)}` : ""}${r.meta ? ` · ${JSON.stringify(r.meta)}` : ""}` : "Not run yet"}</p>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
