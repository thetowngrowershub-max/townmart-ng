import type { Metadata } from "next";
import Link from "next/link";
import { NdpcCountdown } from "@/components/compliance/ndpc-countdown";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { BREACH_STATUS_LABELS, ndpcClock, RISK_LABELS, SUBJECT_NOTICE_LABELS } from "@/lib/compliance/breach";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Breach register" };

export default async function BreachesPage() {
  const user = await requirePermission("compliance.manage", "/admin/compliance/breaches");
  const rows = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.breachIncident.findMany({ orderBy: [{ status: "asc" }, { awareAt: "desc" }] }));
  return (
    <>
      <PageHeader
        title="Breach register"
        description="Every personal data breach, whether or not it's reported. The NDPC must be told within 72 hours of awareness."
        actions={
          <Button asChild>
            <Link href="/admin/compliance/breaches/new">Log a breach</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No breaches logged.</p>
          ) : (
            <ul className="divide-y">
              {rows.map((b) => {
                const clock = ndpcClock(b);
                return (
                  <li key={b.id}>
                    <Link href={`/admin/compliance/breaches/${b.id}`} className="flex flex-wrap items-start justify-between gap-3 p-4 hover:bg-muted">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {b.reference} · {b.title}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Aware {formatDateTime(b.awareAt)} · {b.subjectsAffected ?? "unknown number of"} people · telling them: {SUBJECT_NOTICE_LABELS[b.subjectNotice]}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{BREACH_STATUS_LABELS[b.status]}</Badge>
                        <Badge variant={b.risk === "high" ? "danger" : "outline"}>{RISK_LABELS[b.risk]} risk</Badge>
                        <NdpcCountdown deadline={clock.deadline.toISOString()} notifiedAt={b.ndpcNotifiedAt?.toISOString() ?? null} />
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
