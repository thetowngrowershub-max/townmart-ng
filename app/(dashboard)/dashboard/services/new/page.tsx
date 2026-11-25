import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { ServiceForm } from "@/components/seller/service-form";
import { categoryOptions, EMPTY_SERVICE, homeArea } from "@/lib/seller/catalogue-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Add service" };

export default async function NewServicePage() {
  const ctx = await requireSellerPage("/dashboard/services/new", "listing.write");
  const { categories, area } = await withSellerRls(ctx, async (tx) => ({
    categories: await categoryOptions(tx, "service"),
    area: await homeArea(tx, ctx.business.id),
  }));
  return (
    <>
      <PageHeader title="Add service" />
      <ServiceForm
        serviceId={null}
        categories={categories}
        homeArea={area}
        initial={{ ...EMPTY_SERVICE, serviceLgaIds: [area.lgaId] }}
      />
    </>
  );
}
