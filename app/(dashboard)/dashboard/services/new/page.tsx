import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { ServiceForm } from "@/components/seller/service-form";
import { categoryOptions, EMPTY_SERVICE, lgaGroups } from "@/lib/seller/catalogue-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Add service" };

export default async function NewServicePage() {
  const ctx = await requireSellerPage("/dashboard/services/new", "listing.write");
  const { categories, groups, business } = await withSellerRls(ctx, async (tx) => ({
    categories: await categoryOptions(tx, "service"),
    groups: await lgaGroups(tx),
    business: await tx.business.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { stateId: true, lgaId: true } }),
  }));
  return (
    <>
      <PageHeader title="Add service" />
      <ServiceForm
        serviceId={null}
        categories={categories}
        lgaGroups={groups}
        defaultStateId={business.stateId}
        initial={{ ...EMPTY_SERVICE, serviceLgaIds: [business.lgaId] }}
      />
    </>
  );
}
