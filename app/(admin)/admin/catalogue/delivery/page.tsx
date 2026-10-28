import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RateBands } from "@/components/delivery/rate-bands";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Delivery zones" };

export default async function DeliveryZonesPage() {
  const user = await requirePermission("settings.manage", "/admin/catalogue/delivery");
  const { zones, states } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const [zones, states, custom] = await Promise.all([
      tx.deliveryZone.findMany({ orderBy: [{ isActive: "desc" }, { priority: "asc" }], include: { rates: { where: { businessId: null }, orderBy: { minWeightG: "asc" } } } }),
      tx.state.findMany({ select: { id: true, name: true } }),
      tx.deliveryRate.groupBy({ by: ["zoneId"], where: { businessId: { not: null } }, _count: { businessId: true } }),
    ]);
    const sellers = new Map(custom.map((c) => [c.zoneId, c._count.businessId]));
    return { zones: zones.map((z) => ({ ...z, customSellers: sellers.get(z.id) ?? 0 })), states: new Map(states.map((s) => [s.id, s.name])) };
  });
  const covered = new Set(zones.filter((z) => z.isActive).flatMap((z) => z.stateIds));
  const missing = [...states.entries()].filter(([id]) => !covered.has(id)).map(([, name]) => name);

  return (
    <>
      <PageHeader
        title="Delivery zones"
        description="Where TownMart delivers and its default fees by parcel weight. Sellers can set their own rates for any zone."
        actions={
          <Button asChild size="sm">
            <Link href="/admin/catalogue/delivery/new">
              <Plus aria-hidden /> New zone
            </Link>
          </Button>
        }
      />
      {missing.length > 0 && (
        <Alert variant="warning" className="mb-4">
          Not in any zone, so shoppers there can&apos;t get delivery: {missing.join(", ")}.
        </Alert>
      )}
      <div className="flex flex-col gap-4">
        {zones.map((z) => (
          <Card key={z.id}>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  <Link href={`/admin/catalogue/delivery/${z.id}`} className="underline-offset-2 hover:underline">
                    {z.name}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {z.stateIds.map((id) => states.get(id)).join(", ")}
                  {z.lgaIds.length > 0 && ` · ${z.lgaIds.length} LGA${z.lgaIds.length === 1 ? "" : "s"}`} · priority {z.priority}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {!z.isActive && <Badge variant="secondary">Not in use</Badge>}
                {z.customSellers > 0 && <Badge variant="outline">{z.customSellers} seller rate{z.customSellers === 1 ? "" : "s"}</Badge>}
              </div>
            </CardHeader>
            <CardContent>
              <RateBands rates={z.rates} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
