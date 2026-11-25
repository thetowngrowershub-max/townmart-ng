import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalEditor } from "@/components/compliance/legal-editor";
import { PageHeader } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { dateToLagosLocal, formatDate, formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { isLegalSlug } from "@/lib/legal/documents";

export const metadata: Metadata = { title: "Edit legal page" };

export default async function EditLegalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requirePermission("compliance.manage", `/admin/compliance/legal/${slug}`);
  if (!isLegalSlug(slug)) notFound();
  const versions = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.legalDocument.findMany({ where: { slug }, orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }] }));
  const latest = versions[0];
  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link href="/admin/compliance/legal">
          <ArrowLeft className="size-4" aria-hidden /> Legal pages
        </Link>
      </Button>
      <PageHeader title={latest?.title ?? slug} description={`Starts from the latest version${latest ? ` (${latest.version})` : ""}. Publishing adds a new version; nothing is overwritten.`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardContent className="pt-6">
            <LegalEditor
              initial={{ slug, title: latest?.title ?? "", summary: latest?.summary ?? "", bodyHtml: latest?.bodyHtml ?? "", effectiveAt: dateToLagosLocal(new Date()), changeNote: "", isTemplate: latest?.isTemplate ?? true }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Versions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {versions.map((v) => (
                <li key={v.id}>
                  <Link href={`/legal/${slug}?v=${encodeURIComponent(v.version)}`} className="font-medium text-primary hover:underline">
                    {v.version}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    From {formatDate(v.effectiveAt)} · published {formatDateTime(v.createdAt)}
                    {v.changeNote ? ` · ${v.changeNote}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
