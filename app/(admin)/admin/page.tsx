import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DashboardTiles, GmvChart } from "@/components/analytics/dashboard-view";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { dashboard } from "@/lib/analytics/metrics";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Overview" };

export default async function AdminOverviewPage() {
  const user = await requirePermission("admin.access", "/admin");
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const { d, queue } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const [d, applications, reports, reviews, disputes, failedRefunds, requests, overdueRequests, breaches, failedJobs] = await Promise.all([
      dashboard(tx, 30, now),
      tx.business.count({ where: { status: { in: ["pending", "under_review"] } } }),
      tx.listingReport.count({ where: { status: "open" } }),
      tx.review.count({ where: { status: "reported" } }),
      tx.dispute.count({ where: { status: "open" } }),
      tx.refund.count({ where: { status: "failed" } }),
      tx.dataSubjectRequest.count({ where: { status: { in: ["open", "in_progress"] } } }),
      tx.dataSubjectRequest.count({ where: { status: { in: ["open", "in_progress"] }, dueAt: { lt: now } } }),
      tx.breachIncident.count({ where: { status: { not: "closed" } } }),
      tx.jobRun.count({ where: { status: "failed", startedAt: { gte: dayAgo } } }),
    ]);
    return {
      d,
      queue: [
        { label: "Seller applications to review", count: applications, href: "/admin/sellers", urgent: false },
        { label: "Reported listings", count: reports, href: "/admin/moderation", urgent: false },
        { label: "Reported reviews", count: reviews, href: "/admin/moderation/reviews", urgent: false },
        { label: "Open disputes", count: disputes, href: "/admin/orders", urgent: false },
        { label: "Refunds the provider refused", count: failedRefunds, href: "/admin/payouts", urgent: failedRefunds > 0 },
        { label: overdueRequests ? `Data requests (${overdueRequests} overdue)` : "Data requests", count: requests, href: "/admin/compliance/requests", urgent: overdueRequests > 0 },
        { label: "Breaches not closed", count: breaches, href: "/admin/compliance/breaches", urgent: breaches > 0 },
        { label: "Background jobs failed in the last day", count: failedJobs, href: "/admin/system", urgent: failedJobs > 0 },
      ],
    };
  });
  const waiting = queue.filter((q) => q.count > 0);

  return (
    <>
      <PageHeader title="Overview" description="What needs attention, and the last 30 days at a glance." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Needs attention</CardTitle>
            <CardDescription>{waiting.length ? "Queues with something waiting." : "Nothing is waiting. All queues are clear."}</CardDescription>
          </CardHeader>
          {waiting.length > 0 && (
            <CardContent>
              <ul className="grid gap-2 sm:grid-cols-2">
                {waiting.map((q) => (
                  <li key={q.href + q.label}>
                    <Link href={q.href} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm hover:bg-muted">
                      <span>{q.label}</span>
                      <span className="flex items-center gap-1">
                        <Badge variant={q.urgent ? "danger" : "secondary"}>{q.count}</Badge>
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>

        <DashboardTiles d={d} />
        <GmvChart d={d} />
        {can(user, "analytics.view") && (
          <p className="text-sm">
            <Link href="/admin/analytics" className="font-medium text-primary underline">
              Open analytics
            </Link>{" "}
            for 7, 30 or 90 days, top categories, sellers and states, and a CSV download.
          </p>
        )}
      </div>
    </>
  );
}
