import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RiderModePicker } from "@/components/seller/rider-mode";
import { RidersManager } from "@/components/seller/riders-manager";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { decrypt } from "@/lib/crypto";
import type { RiderVehicle } from "@/lib/fulfilment/rider-vehicles";
import { can } from "@/lib/authz";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

/** +2348031234567 as 08031234567, how people type it. */
const localPhone = (e164: string) => (e164.startsWith("+234") ? `0${e164.slice(4)}` : e164);

export const metadata: Metadata = { title: "Riders" };

export default async function RidersPage() {
  const ctx = await requireSellerPage("/dashboard/riders", "order.manage");
  const { riders, jobs, located } = await withSellerRls(ctx, async (tx) => ({
    riders: await tx.rider.findMany({ where: { businessId: ctx.business.id, isActive: true }, orderBy: { name: "asc" } }),
    jobs: await tx.sellerOrder.groupBy({ by: ["riderId"], where: { businessId: ctx.business.id, riderId: { not: null }, status: { in: ["paid", "processing", "shipped"] } }, _count: true }),
    located: await tx.business.findUnique({ where: { id: ctx.business.id }, select: { latitude: true, riderMode: true } }),
  }));
  const active = new Map(jobs.map((j) => [j.riderId, j._count]));
  return (
    <>
      <PageHeader title="Riders" description="Who delivers your orders: TownMart riders, your own riders, or both." />
      <div className="flex flex-col gap-4">
        {located?.latitude == null && (
          <Alert variant="warning">
            Set your shop&apos;s location in{" "}
            <Link href="/dashboard/settings#shop-location" className="underline">
              Store settings
            </Link>{" "}
            so delivery fees are worked out by distance and nearby riders can be found.
          </Alert>
        )}
        <Card>
          <CardContent className="pt-6">
            <RiderModePicker mode={located?.riderMode === "own" ? "own" : "townmart"} canManage={can(ctx.user, "store.manage", { businessId: ctx.business.id })} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6">
            <p className="font-semibold">Your own riders</p>
            <p className="text-sm text-muted-foreground">Optional. Add them to assign them to any delivery; the nearest free one is suggested first.</p>
            <RidersManager
              riders={riders.map((r) => ({
                id: r.id,
                name: r.name,
                phone: localPhone(decrypt(r.phoneEncrypted)),
                vehicle: r.vehicle as RiderVehicle,
                isAvailable: r.isAvailable,
                activeJobs: active.get(r.id) ?? 0,
              }))}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
