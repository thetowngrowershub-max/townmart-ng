import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CategoryAttributesForm, CategoryForm } from "@/components/admin/catalogue-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Edit category" };

export default async function EditCategoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("catalogue.manage", `/admin/catalogue/categories/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const category = await tx.category.findUnique({
      where: { id },
      include: { attributes: { orderBy: { sortOrder: "asc" }, select: { attributeId: true, isRequired: true } }, _count: { select: { products: true, services: true } } },
    });
    if (!category) return null;
    const [parents, attributes] = await Promise.all([
      tx.category.findMany({ where: { parentId: null }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
      tx.attribute.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, type: true } }),
    ]);
    return { category, parents, attributes };
  });
  if (!data) notFound();
  const c = data.category;
  const listings = c._count.products + c._count.services;

  return (
    <>
      <PageHeader title={c.name} description={`${listings.toLocaleString("en-NG")} listing${listings === 1 ? "" : "s"} · /${c.slug}`} />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CategoryForm
              initial={{ id: c.id, name: c.name, slug: c.slug, kind: c.kind, parentId: c.parentId ?? "", icon: c.icon ?? "", sortOrder: String(c.sortOrder), isActive: c.isActive }}
              parents={data.parents}
            />
          </CardContent>
        </Card>
        {c.kind === "product" && (
          <Card>
            <CardHeader>
              <CardTitle>Attributes</CardTitle>
              <CardDescription>
                Extra fields sellers fill in for products in this category, such as size or screen size. Subcategories ask for their parent&apos;s attributes too. Manage the list on{" "}
                <Link href="/admin/catalogue/attributes" className="font-medium text-primary underline">
                  Attributes
                </Link>
                .
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CategoryAttributesForm categoryId={c.id} initial={c.attributes} attributes={data.attributes} />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
