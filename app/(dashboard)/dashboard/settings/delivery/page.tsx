import type { DeliveryRate } from "@prisma/client";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { ZoneRatesForm, type BandRow } from "@/components/seller/zone-rates-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPrice, koboToNairaString } from "@/lib/money";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Delivery rates" };

const kg = (g: number) => `${g / 1000} kg`;
const bandLabel = (r: DeliveryRate) => (r.maxWeightG === null ? `${kg(r.minWeightG)} and over` : r.minWeightG === 0 ? `Up to ${kg(r.maxWeightG)}` : `${kg(r.minWeightG)} – ${kg(r.maxWeightG)}`);
const toRow = (r: DeliveryRate): BandRow => ({
  upToKg: r.maxWeightG === null ? "" : String(r.maxWeightG / 1000),
  fee: koboToNairaString(r.feeKobo),
  freeOver: r.freeOverKobo === null ? "" : koboToNairaString(r.freeOverKobo),
  etaMin: String(r.etaDaysMin),
  etaMax: String(r.etaDaysMax),
});

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
                {shown.length > 0 ? (
                  <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {shown.map((r) => (
                      <div key={r.id} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{bandLabel(r)}</dt>
                        <dd className="text-right tabular-nums">
                          {formatPrice(r.feeKobo)} · {r.etaDaysMin}–{r.etaDaysMax} days
                          {r.freeOverKobo !== null && <span className="block text-xs text-muted-foreground">Free over {formatPrice(r.freeOverKobo)}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">No delivery to this zone yet.</p>
                )}
                <ZoneRatesForm zoneId={z.id} zoneName={z.name} initial={shown.map(toRow)} custom={own.length > 0} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
