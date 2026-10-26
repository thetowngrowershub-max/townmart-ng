import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const user = await requirePermission("admin.access", "/admin");

  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const { totalUsers, newUsers, roleCounts, jobRuns, recentAudit } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    totalUsers: await tx.user.count(),
    newUsers: await tx.user.count({ where: { createdAt: { gte: since } } }),
    roleCounts: await tx.userRole.groupBy({ by: ["role"], _count: { _all: true } }),
    jobRuns: await tx.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    recentAudit: await tx.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, action: true, entityType: true, createdAt: true },
    }),
  }));

  const stats = [
    { label: "Users", value: totalUsers },
    { label: "New in last 7 days", value: newUsers },
    ...roleCounts.map((r) => ({ label: `${r.role.replace("_", " ")}s`, value: r._count._all })),
  ];

  return (
    <>
      <PageHeader title="Overview" description="Platform activity at a glance. GMV, orders and seller KPIs arrive with checkout." />
      <div className="flex flex-col gap-6">
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {stats.map((s) => (
            <li key={s.label}>
              <Card className="p-5">
                <p className="text-sm capitalize text-muted-foreground">{s.label}</p>
                <p className="mt-1 font-heading text-3xl font-bold">{s.value.toLocaleString("en-NG")}</p>
              </Card>
            </li>
          ))}
        </ul>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Background jobs</CardTitle>
              <CardDescription>Latest runs from the worker.</CardDescription>
            </CardHeader>
            <CardContent>
              {jobRuns.length === 0 ? (
                <p className="text-sm text-muted-foreground">No jobs have run yet. Start the worker with `pnpm worker`.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {jobRuns.map((j) => (
                    <li key={j.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="font-mono text-xs">{j.jobName}</span>
                      <span className="flex items-center gap-2 text-muted-foreground">
                        {formatDateTime(j.startedAt)}
                        <Badge variant={j.status === "succeeded" ? "success" : j.status === "failed" ? "danger" : "secondary"}>{j.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent audit events</CardTitle>
              <CardDescription>The audit log is append-only.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {recentAudit.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="font-mono text-xs">{a.action}</span>
                    <span className="text-muted-foreground">{formatDateTime(a.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
