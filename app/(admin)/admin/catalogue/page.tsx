import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const user = await requirePermission("catalogue.manage", "/admin/catalogue");
  const categories = await withRls({ scope: "admin", userId: user.id }, (tx) =>
    tx.category.findMany({
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, slug: true, kind: true, parentId: true, isActive: true, _count: { select: { products: true, services: true, attributes: true } } },
    }),
  );
  const tops = categories.filter((c) => !c.parentId);
  const children = (id: string) => categories.filter((c) => c.parentId === id);

  return (
    <>
      <PageHeader
        title="Categories"
        description="The tree shoppers browse and sellers file listings under, two levels deep. Attributes set the extra fields sellers fill in."
        actions={
          <Button asChild size="sm">
            <Link href="/admin/catalogue/categories/new">
              <Plus aria-hidden /> New category
            </Link>
          </Button>
        }
      />
      {(["product", "service"] as const).map((kind) => (
        <section key={kind} className="mb-8" aria-labelledby={`h-${kind}`}>
          <h2 id={`h-${kind}`} className="mb-3 font-heading text-lg font-semibold">
            {kind === "product" ? "Product categories" : "Service categories"}
          </h2>
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Listings</th>
                  <th className="px-4 py-2 font-medium">Attributes</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {tops
                  .filter((t) => t.kind === kind)
                  .flatMap((t) => [t, ...children(t.id)])
                  .map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className={c.parentId ? "py-2 pr-4 pl-10" : "px-4 py-2 font-medium"}>
                        <Link href={`/admin/catalogue/categories/${c.id}`} className="underline-offset-2 hover:underline">
                          {c.name}
                        </Link>
                        <span className="block text-xs text-muted-foreground">/{c.slug}</span>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{(c._count.products + c._count.services).toLocaleString("en-NG")}</td>
                      <td className="px-4 py-2 tabular-nums">{c._count.attributes}</td>
                      <td className="px-4 py-2">{c.isActive ? <Badge variant="success">Shown</Badge> : <Badge variant="secondary">Hidden</Badge>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Card>
        </section>
      ))}
    </>
  );
}
