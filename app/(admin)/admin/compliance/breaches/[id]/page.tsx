import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BreachForm, type BreachFormValues } from "@/components/compliance/breach-form";
import { NdpcCountdown } from "@/components/compliance/ndpc-countdown";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { requirePermission } from "@/lib/auth/current-user";
import { breachNoticeTemplate, ndpcClock } from "@/lib/compliance/breach";
import { dateToLagosLocal, formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { getCompanyDetails } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Breach" };

const local = (d: Date | null) => (d ? dateToLagosLocal(d) : "");

export default async function BreachPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("compliance.manage", `/admin/compliance/breaches/${id}`);
  const isNew = id === "new";
  if (!isNew && !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { b, company } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    b: isNew ? null : await tx.breachIncident.findUnique({ where: { id } }),
    company: await getCompanyDetails(tx),
  }));
  if (!isNew && !b) notFound();

  const now = local(new Date());
  const initial: BreachFormValues = b
    ? {
        id: b.id,
        title: b.title,
        description: b.description,
        detectedAt: local(b.detectedAt),
        awareAt: local(b.awareAt),
        dataCategories: b.dataCategories.join(", "),
        subjectsAffected: b.subjectsAffected?.toString() ?? "",
        risk: b.risk,
        actions: b.actions ?? "",
        status: b.status,
        ndpcNotifiedAt: local(b.ndpcNotifiedAt),
        ndpcReference: b.ndpcReference ?? "",
        subjectNotice: b.subjectNotice,
        subjectsNotifiedAt: local(b.subjectsNotifiedAt),
      }
    : { title: "", description: "", detectedAt: now, awareAt: now, dataCategories: "", subjectsAffected: "", risk: "medium", actions: "", status: "open", ndpcNotifiedAt: "", ndpcReference: "", subjectNotice: "pending", subjectsNotifiedAt: "" };
  const clock = b ? ndpcClock(b) : null;
  const notice = b ? breachNoticeTemplate(b, company) : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link href="/admin/compliance/breaches">
          <ArrowLeft className="size-4" aria-hidden /> Breach register
        </Link>
      </Button>
      <PageHeader title={b ? `${b.reference}: ${b.title}` : "Log a breach"} description={b ? `Logged ${formatDateTime(b.createdAt)}` : "Record it as soon as you know. You can fill in the rest as you learn more."} />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardContent className="pt-6">
            <BreachForm initial={initial} />
          </CardContent>
        </Card>
        {b && clock && notice && (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>NDPC notification</CardTitle>
                <CardDescription>Due {formatDateTime(clock.deadline)}: 72 hours after TownMart became aware.</CardDescription>
              </CardHeader>
              <CardContent>
                <NdpcCountdown deadline={clock.deadline.toISOString()} notifiedAt={b.ndpcNotifiedAt?.toISOString() ?? null} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Email to the people affected</CardTitle>
                <CardDescription>A starting point in plain language. Check every line before sending.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-sm">
                  <span className="text-muted-foreground">Subject:</span> {notice.subject}
                </p>
                <label htmlFor="breach-notice" className="sr-only">
                  Email text
                </label>
                <Textarea id="breach-notice" readOnly rows={16} defaultValue={notice.body} className="font-mono text-xs" />
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
