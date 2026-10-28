import type { Metadata } from "next";
import { CategoryForm } from "@/components/admin/catalogue-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "New category" };

export default async function NewCategoryPage() {
  const user = await requirePermission("catalogue.manage", "/admin/catalogue/categories/new");
  const parents = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.category.findMany({ where: { parentId: null }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }));
  return (
    <>
      <PageHeader title="New category" />
      <Card>
        <CardContent className="pt-6">
          <CategoryForm initial={{ name: "", slug: "", kind: "product", parentId: "", icon: "", sortOrder: "0", isActive: true }} parents={parents} />
        </CardContent>
      </Card>
    </>
  );
}
