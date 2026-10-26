import { ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { DeleteListingButton } from "@/components/seller/delete-listing-button";
import { ServiceForm } from "@/components/seller/service-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { categoryOptions, lgaGroups, serviceToFormValues } from "@/lib/seller/catalogue-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Edit service" };

export default async function EditServicePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/services/${id}`, "listing.write");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withSellerRls(ctx, async (tx) => ({
    service: await tx.service.findFirst({
      where: { id, businessId: ctx.business.id, deletedAt: null },
      include: { packages: true, images: true, availability: true, blackouts: true },
    }),
    categories: await categoryOptions(tx, "service"),
    groups: await lgaGroups(tx),
    business: await tx.business.findUniqueOrThrow({ where: { id: ctx.business.id }, select: { stateId: true } }),
  }));
  const { service } = data;
  if (!service) notFound();
  return (
    <>
      <PageHeader
        title={service.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {service.status === "active" && ctx.business.status === "approved" && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/s/${service.slug}`} target="_blank">
                  <ExternalLink aria-hidden /> View
                </Link>
              </Button>
            )}
            <DeleteListingButton kind="service" id={id} />
          </div>
        }
      />
      {(await searchParams).saved && <Alert variant="success" className="mb-4">Service created.</Alert>}
      <ServiceForm serviceId={id} categories={data.categories} lgaGroups={data.groups} defaultStateId={data.business.stateId} initial={serviceToFormValues(service)} />
    </>
  );
}
