import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { listDataRequests, type RequestFilter } from "@/lib/compliance/view";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { deadline, DSR_STATUS_LABELS, DSR_TYPE_LABELS, OPEN_STATUSES } from "@/lib/privacy/requests";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Data requests" };

const FILTERS: { key: RequestFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "unverified", label: "Awaiting email check" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
];

export default async function DataRequestsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePermission("compliance.manage", "/admin/compliance/requests");
  const requested = (await searchParams).show;
  const show: RequestFilter = FILTERS.find((f) => f.key === requested)?.key ?? "open";
  const rows = await withRls({ scope: "admin", userId: user.id }, (tx) => listDataRequests(tx, show));
  const now = new Date();

  return (
    <>
      <PageHeader title="Data requests" description="Access, correction, deletion and objection requests, soonest deadline first." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/admin/compliance/requests?show=${f.key}`} aria-current={f.key === show ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-sm", f.key === show ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}>
            {f.label}
          </Link>
        ))}
      </div>
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => {
                const due = OPEN_STATUSES.includes(r.status) ? deadline(r.dueAt, now) : null;
                return (
                  <li key={r.id}>
                    <Link href={`/admin/compliance/requests/${r.id}`} className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-muted">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {r.reference} · {DSR_TYPE_LABELS[r.type]}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {r.name ?? "No name"} · {r.channel === "public_form" ? "Public form" : "Privacy Centre"} · {formatDateTime(r.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 text-sm">
                        <Badge variant={r.status === "completed" ? "default" : r.status === "rejected" ? "danger" : "secondary"}>{DSR_STATUS_LABELS[r.status]}</Badge>
                        {due && r.dueAt && (
                          <span className={cn("text-xs", due.overdue ? "font-semibold text-danger" : due.daysLeft <= 7 ? "font-semibold" : "text-muted-foreground")}>
                            {due.label} · {formatDate(r.dueAt)}
                          </span>
                        )}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
