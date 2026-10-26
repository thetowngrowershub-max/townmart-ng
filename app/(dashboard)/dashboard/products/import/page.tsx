import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { ImportForm } from "@/components/seller/import-form";
import { IMPORT_STATUS } from "@/components/seller/import-status";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportPage() {
  const ctx = await requireSellerPage("/dashboard/products/import", "import.manage");
  const [jobs, categories] = await withSellerRls(ctx, async (tx) => [
    await tx.importJob.findMany({ where: { businessId: ctx.business.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    await tx.category.findMany({ where: { kind: "product", isActive: true }, orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }], select: { slug: true, name: true, parentId: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Import products from CSV"
        actions={
          <Link href="/dashboard/products" className="text-sm text-primary underline">
            Back to products
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upload</CardTitle>
            <CardDescription>
              One row per variant. Rows with the same <code>handle</code> form one product. Existing variants are matched by SKU and updated;
              new SKUs are added. Images are added in the dashboard afterwards.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3 text-sm">
              <a href="/api/seller/products/template" className="font-semibold text-primary underline">
                Download the template
              </a>
              <a href="/api/seller/products/export" className="font-semibold text-primary underline">
                Export your current products
              </a>
            </div>
            <ImportForm />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Category slugs</CardTitle>
            <CardDescription>Use one of these in the <code>category</code> column.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
              {categories.map((c) => (
                <li key={c.slug} className={c.parentId ? "" : "font-semibold"}>
                  <code>{c.slug}</code> <span className="text-muted-foreground">{c.name}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Recent imports</CardTitle>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <ul className="divide-y text-sm">
              {jobs.map((j) => {
                const s = IMPORT_STATUS[j.status];
                return (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Link href={`/dashboard/products/import/${j.id}`} className="font-medium text-primary underline">
                      {j.fileName}
                    </Link>
                    <Badge variant={s.variant}>{s.label}</Badge>
                    <span className="text-muted-foreground">{formatDateTime(j.createdAt)}</span>
                    {j.status === "completed" && (
                      <span className="ml-auto">
                        {j.succeededRows} imported, {j.failedRows} with errors
                      </span>
                    )}
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
