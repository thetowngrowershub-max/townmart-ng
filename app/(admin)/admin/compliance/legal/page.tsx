import type { Metadata } from "next";
import Link from "next/link";
import { CompanyForm } from "@/components/compliance/settings-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { legalOverview } from "@/lib/compliance/view";
import { formatDate } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { COMPANY_FIELDS, COMPANY_KEYS, getCompanyDetails } from "@/lib/legal/company";

export const metadata: Metadata = { title: "Legal pages" };

export default async function LegalPagesAdmin() {
  const user = await requirePermission("compliance.manage", "/admin/compliance/legal");
  const { pages, company } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({ pages: await legalOverview(tx), company: await getCompanyDetails(tx) }));
  return (
    <>
      <PageHeader title="Legal pages" description="Every page under /legal, versioned. Publishing makes a new version; acceptances always point at the version accepted." />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {pages.map((p) => (
                <li key={p.slug} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <Link href={`/admin/compliance/legal/${p.slug}`} className="font-medium hover:underline">
                      {p.current?.title ?? p.slug}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {p.current ? `Version ${p.current.version}, in force since ${formatDate(p.current.effectiveAt)}` : "Not published"}
                      {p.upcoming ? ` · ${p.upcoming.version} from ${formatDate(p.upcoming.effectiveAt)}` : ""} · {p.versions} version{p.versions === 1 ? "" : "s"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.current?.isTemplate && <Badge variant="warning">Template</Badge>}
                    <Link href={`/legal/${p.slug}`} className="text-sm text-primary hover:underline">
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Company details</CardTitle>
            <CardDescription>Filled into the legal pages wherever they say {"{{company.…}}"}. Blank ones show as highlighted gaps.</CardDescription>
          </CardHeader>
          <CardContent>
            <CompanyForm fields={COMPANY_KEYS.map((k) => ({ key: k, label: COMPANY_FIELDS[k], value: company[k] ?? "" }))} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
