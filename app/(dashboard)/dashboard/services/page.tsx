import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { ListingTable } from "@/components/seller/listing-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPrice } from "@/lib/money";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { publicImageUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Services" };

const PRICE_PREFIX = { fixed: "", from: "From ", hourly: "", packages: "From " } as const;

export default async function ServicesPage() {
  const ctx = await requireSellerPage("/dashboard/services", "listing.read");
  const services = await withSellerRls(ctx, (tx) =>
    tx.service.findMany({
      where: { businessId: ctx.business.id, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        status: true,
        pricingModel: true,
        basePriceKobo: true,
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { storageKey: true } },
        _count: { select: { availability: true } },
      },
    }),
  );

  return (
    <>
      <PageHeader
        title="Services"
        description={ctx.business.sellsServices ? undefined : "Your store is set up for products. Services you add here still appear on your store page."}
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/services/new">
              <Plus aria-hidden /> Add service
            </Link>
          </Button>
        }
      />
      {services.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No services yet.</Card>
      ) : (
        <ListingTable
          kind="service"
          rows={services.map((s) => ({
            id: s.id,
            title: s.title,
            href: `/dashboard/services/${s.id}`,
            imageUrl: s.images[0] ? publicImageUrl(s.images[0].storageKey) : null,
            price: `${PRICE_PREFIX[s.pricingModel]}${formatPrice(s.basePriceKobo)}${s.pricingModel === "hourly" ? "/hr" : ""}`,
            status: s.status,
            detail: s._count.availability ? `${s._count.availability} weekly time window${s._count.availability === 1 ? "" : "s"}` : "No availability set",
            warning: s._count.availability ? undefined : "Can't publish",
          }))}
        />
      )}
    </>
  );
}
