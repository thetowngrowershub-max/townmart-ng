import type { Metadata } from "next";
import Link from "next/link";
import { FaqForm } from "@/components/admin/content-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Help centre" };

export default async function HelpAdminPage() {
  const user = await requirePermission("content.manage", "/admin/content/help");
  const entries = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.faqEntry.findMany({ orderBy: [{ section: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }));
  const sections = [...new Set(entries.map((e) => e.section))];

  return (
    <>
      <PageHeader
        title="Help centre"
        description={
          <>
            Questions and answers on the public{" "}
            <Link href="/help" className="underline">
              help centre
            </Link>
            , grouped by section.
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>New question</CardTitle>
          </CardHeader>
          <CardContent>
            <FaqForm initial={{ section: sections[0] ?? "", question: "", answerHtml: "", sortOrder: "0", isPublished: true }} sections={sections} />
          </CardContent>
        </Card>
        {sections.map((s) => (
          <section key={s} aria-labelledby={`sec-${s}`} className="flex flex-col gap-3">
            <h2 id={`sec-${s}`} className="font-heading text-lg font-semibold">
              {s}
            </h2>
            {entries
              .filter((e) => e.section === s)
              .map((e) => (
                <details key={e.id} className="rounded-2xl border bg-card">
                  <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4 text-sm font-medium">
                    {e.question}
                    {!e.isPublished && <Badge variant="secondary">Draft</Badge>}
                  </summary>
                  <div className="border-t px-5 py-4">
                    <FaqForm initial={{ id: e.id, section: e.section, question: e.question, answerHtml: e.answerHtml, sortOrder: String(e.sortOrder), isPublished: e.isPublished }} sections={sections} />
                  </div>
                </details>
              ))}
          </section>
        ))}
      </div>
    </>
  );
}
