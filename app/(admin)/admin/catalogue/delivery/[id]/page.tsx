import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ZoneForm } from "@/components/admin/catalogue-forms";
import { RateBands, toBandRow } from "@/components/delivery/rate-bands";
import { PageHeader } from "@/components/layout/app-shell";
import { ZoneRatesForm } from "@/components/seller/zone-rates-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Delivery zone" };

export default async function ZonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("settings.manage", `/admin/catalogue/delivery/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const zone = await tx.deliveryZone.findUnique({ where: { id }, include: { rates: { where: { businessId: null }, orderBy: { minWeightG: "asc" } } } });
    if (!zone) return null;
    const [states, sellers] = await Promise.all([
      tx.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      tx.deliveryRate.findMany({ where: { zoneId: id, businessId: { not: null } }, distinct: ["businessId"], select: { business: { select: { name: true } } } }),
    ]);
    return { zone, states, sellers: sellers.map((s) => s.business?.name).filter(Boolean) };
  });
  if (!data) notFound();
  const z = data.zone;

  return (
    <>
      <PageHeader title={z.name} />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>TownMart&apos;s rates</CardTitle>
            <CardDescription>
              {data.sellers.length ? `Used by every seller except ${data.sellers.join(", ")}, who set their own.` : "Used by every seller delivering to this zone."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RateBands rates={z.rates} />
            <ZoneRatesForm zoneId={z.id} zoneName={z.name} initial={z.rates.map(toBandRow)} custom={false} platform />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Zone</CardTitle>
            {z.lgaIds.length > 0 && <CardDescription>This zone also matches {z.lgaIds.length} LGAs set up when it was created. They match before states.</CardDescription>}
          </CardHeader>
          <CardContent>
            <ZoneForm initial={{ id: z.id, name: z.name, stateIds: z.stateIds, priority: String(z.priority), isActive: z.isActive }} states={data.states} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
