import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RidersManager } from "@/components/seller/riders-manager";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { decrypt } from "@/lib/crypto";
import type { RiderVehicle } from "@/lib/fulfilment/rider-vehicles";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

/** +2348031234567 as 08031234567, how people type it. */
const localPhone = (e164: string) => (e164.startsWith("+234") ? `0${e164.slice(4)}` : e164);

export const metadata: Metadata = { title: "Riders" };

export default async function RidersPage() {
  const ctx = await requireSellerPage("/dashboard/riders", "order.manage");
  const { riders, jobs, located } = await withSellerRls(ctx, async (tx) => ({
    riders: await tx.rider.findMany({ where: { businessId: ctx.business.id, isActive: true }, orderBy: { name: "asc" } }),
    jobs: await tx.sellerOrder.groupBy({ by: ["riderId"], where: { businessId: ctx.business.id, riderId: { not: null }, status: { in: ["paid", "processing", "shipped"] } }, _count: true }),
    located: await tx.business.findUnique({ where: { id: ctx.business.id }, select: { latitude: true } }),
  }));
  const active = new Map(jobs.map((j) => [j.riderId, j._count]));
  return (
    <>
      <PageHeader title="Riders" description="The people who deliver your orders. Assign one on each delivery order; the nearest free rider is suggested first." />
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
