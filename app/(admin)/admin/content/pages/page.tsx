import type { Metadata } from "next";
import Link from "next/link";
import { CmsPageForm } from "@/components/admin/content-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { CMS_PAGE_SLUGS } from "@/lib/validation/cms";

export const metadata: Metadata = { title: "About and contact" };

export default async function CmsPagesPage() {
  const user = await requirePermission("content.manage", "/admin/content/pages");
  const pages = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.cmsPage.findMany({ where: { slug: { in: [...CMS_PAGE_SLUGS] } } }));
  return (
    <>
      <PageHeader
        title="About and contact"
        description={
          <>
            Legal pages are versioned separately in{" "}
            <Link href="/admin/compliance/legal" className="underline">
              Compliance
            </Link>
            .
          </>
        }
      />
      <div className="flex flex-col gap-6">
        {CMS_PAGE_SLUGS.map((slug) => {
          const p = pages.find((x) => x.slug === slug);
          return (
            <Card key={slug}>
              <CardHeader>
                <CardTitle>
                  <Link href={`/${slug}`} className="underline-offset-2 hover:underline">
                    /{slug}
                  </Link>
                </CardTitle>
                <CardDescription>{p ? `Last changed ${formatDateTime(p.updatedAt)}` : "Not written yet, so the page shows a short default."}</CardDescription>
              </CardHeader>
              <CardContent>
                <CmsPageForm initial={{ slug, title: p?.title ?? (slug === "about" ? "About TownMart" : "Contact us"), summary: p?.summary ?? "", bodyHtml: p?.bodyHtml ?? "" }} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
