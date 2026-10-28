import type { Metadata } from "next";
import Link from "next/link";
import { DashboardRankings, DashboardTiles, GmvChart, MetricDefinitions } from "@/components/analytics/dashboard-view";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { dashboard, parseRange, RANGES } from "@/lib/analytics/metrics";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { formatDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePermission("analytics.view", "/admin/analytics");
  const days = parseRange((await searchParams).days);
  const d = await withRls({ scope: "admin", userId: user.id }, (tx) => dashboard(tx, days));

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`${formatDate(d.period.from)} to today, compared with the ${days} days before.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Period" className="flex rounded-full border p-1">
              {RANGES.map((r) => (
                <Link
                  key={r}
                  href={`/admin/analytics?days=${r}`}
                  aria-current={r === days ? "page" : undefined}
                  className={cn("rounded-full px-3 py-1 text-sm", r === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {r} days
                </Link>
              ))}
            </nav>
            <Button asChild variant="outline" size="sm">
              <a href={`/api/admin/analytics?days=${days}`} download>
                Download CSV
              </a>
            </Button>
          </div>
        }
      />
      <div className="flex flex-col gap-6">
        <DashboardTiles d={d} />
        <GmvChart d={d} />
        <DashboardRankings d={d} />
        <MetricDefinitions />
      </div>
    </>
  );
}
