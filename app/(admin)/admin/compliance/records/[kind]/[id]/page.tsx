import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActivityForm, DpiaForm, ProcessorForm } from "@/components/compliance/record-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Edit record" };

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d) : "");

export default async function RecordPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const user = await requirePermission("compliance.manage", `/admin/compliance/records/${kind}/${id}`);
  const isNew = id === "new";
  if (!["activity", "processor", "dpia"].includes(kind) || (!isNew && !/^[0-9a-f-]{36}$/i.test(id))) notFound();

  const form = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    if (kind === "activity") {
      const a = isNew ? null : await tx.processingActivity.findUnique({ where: { id } });
      if (!isNew && !a) return null;
      return (
        <ActivityForm
          initial={
            a
              ? { id: a.id, name: a.name, purpose: a.purpose, lawfulBasis: a.lawfulBasis, dataSubjects: a.dataSubjects.join(", "), dataCategories: a.dataCategories.join(", "), recipients: a.recipients.join(", "), transfers: a.transfers ?? "", retention: a.retention, security: a.security ?? "" }
              : { name: "", purpose: "", lawfulBasis: "contract", dataSubjects: "", dataCategories: "", recipients: "", transfers: "", retention: "", security: "" }
          }
        />
      );
    }
    if (kind === "processor") {
      const p = isNew ? null : await tx.dataProcessor.findUnique({ where: { id } });
      if (!isNew && !p) return null;
      return (
        <ProcessorForm
          initial={
            p
              ? { id: p.id, name: p.name, service: p.service, dataCategories: p.dataCategories.join(", "), location: p.location, safeguards: p.safeguards ?? "", dpaSignedAt: day(p.dpaSignedAt), website: p.website ?? "", active: p.active }
              : { name: "", service: "", dataCategories: "", location: "", safeguards: "", dpaSignedAt: "", website: "", active: true }
          }
        />
      );
    }
    const d = isNew ? null : await tx.dpiaRecord.findUnique({ where: { id } });
    if (!isNew && !d) return null;
    const activities = await tx.processingActivity.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } });
    return (
      <DpiaForm
        activities={activities}
        initial={
          d
            ? { id: d.id, title: d.title, activityId: d.activityId ?? "", description: d.description, risks: d.risks, mitigations: d.mitigations, residualRisk: d.residualRisk, status: d.status, nextReviewAt: day(d.nextReviewAt) }
            : { title: "", activityId: "", description: "", risks: "", mitigations: "", residualRisk: "medium", status: "draft", nextReviewAt: "" }
        }
      />
    );
  });
  if (!form) notFound();
  const noun = kind === "activity" ? "processing activity" : kind === "processor" ? "processor" : "impact assessment";

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link href="/admin/compliance/records">
          <ArrowLeft className="size-4" aria-hidden /> RoPA & DPIAs
        </Link>
      </Button>
      <PageHeader title={isNew ? `Add a ${noun}` : `Edit ${noun}`} />
      <Card className="max-w-3xl">
        <CardContent className="pt-6">{form}</CardContent>
      </Card>
    </>
  );
}
