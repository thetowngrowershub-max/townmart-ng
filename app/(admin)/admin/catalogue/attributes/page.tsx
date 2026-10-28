import type { Metadata } from "next";
import { AttributeForm } from "@/components/admin/catalogue-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Attributes" };

export default async function AttributesPage() {
  const user = await requirePermission("catalogue.manage", "/admin/catalogue/attributes");
  const attributes = await withRls({ scope: "admin", userId: user.id }, (tx) =>
    tx.attribute.findMany({ orderBy: { name: "asc" }, include: { categories: { select: { category: { select: { name: true } } } } } }),
  );
  return (
    <>
      <PageHeader title="Attributes" description="Fields sellers fill in for products, such as size or material. Add them to categories from each category's page." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>New attribute</CardTitle>
          </CardHeader>
          <CardContent>
            <AttributeForm initial={{ name: "", slug: "", type: "text", options: "" }} />
          </CardContent>
        </Card>
        {attributes.map((a) => (
          <Card key={a.id}>
            <CardHeader>
              <CardTitle className="text-base">{a.name}</CardTitle>
              <CardDescription>{a.categories.length ? `Used in ${a.categories.map((c) => c.category.name).join(", ")}` : "Not used in any category"}</CardDescription>
            </CardHeader>
            <CardContent>
              <AttributeForm initial={{ id: a.id, name: a.name, slug: a.slug, type: a.type, options: a.options.join("\n") }} used={a.categories.length} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
