import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RateBands, toBandRow } from "@/components/delivery/rate-bands";
import { ZoneRatesForm } from "@/components/seller/zone-rates-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Delivery rates" };

export default async function DeliveryRatesPage() {
  const ctx = await requireSellerPage("/dashboard/settings/delivery", "store.manage");
  const zones = await withSellerRls(ctx, (tx) =>
    tx.deliveryZone.findMany({
      where: { isActive: true },
      orderBy: { priority: "asc" },
      include: { rates: { where: { OR: [{ businessId: null }, { businessId: ctx.business.id }] }, orderBy: { minWeightG: "asc" } } },
    }),
  );

  return (
    <>
      <PageHeader
        title="Delivery rates"
        description="What customers pay you for delivery, by area and parcel weight. Zones you don't change use TownMart's rates."
        actions={
          <Button asChild size="sm" variant="ghost">
            <Link href="/dashboard/settings">
              <ArrowLeft aria-hidden /> Store settings
            </Link>
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        {zones.map((z) => {
          const own = z.rates.filter((r) => r.businessId === ctx.business.id);
          const shown = own.length ? own : z.rates.filter((r) => r.businessId === null);
          return (
            <Card key={z.id}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">{z.name}</CardTitle>
                  <CardDescription>{own.length ? "Your rates" : "TownMart's rates"}</CardDescription>
                </div>
                {own.length > 0 && <Badge variant="success">Custom</Badge>}
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <RateBands rates={shown} />
                <ZoneRatesForm zoneId={z.id} zoneName={z.name} initial={shown.map(toBandRow)} custom={own.length > 0} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
