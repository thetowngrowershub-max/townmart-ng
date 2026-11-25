import type { Metadata } from "next";
import { FeaturedStoresForm } from "@/components/admin/content-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Featured stores" };

export default async function FeaturedStoresPage() {
  const user = await requirePermission("content.manage", "/admin/content/featured");
  const { featured, stores } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    featured: await tx.featuredStore.findMany({ orderBy: { sortOrder: "asc" }, select: { businessId: true } }),
    stores: await tx.business.findMany({ where: { status: "approved" }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
  }));
  return (
    <>
      <PageHeader title="Featured stores" description="Stores shown on the homepage, in this order. A store that stops being approved drops off automatically." />
      <Card>
        <CardContent className="pt-6">
          <FeaturedStoresForm initial={featured.map((f) => f.businessId)} stores={stores} />
        </CardContent>
      </Card>
    </>
  );
}
