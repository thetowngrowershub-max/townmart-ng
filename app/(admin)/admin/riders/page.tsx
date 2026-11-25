import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RiderReviewButtons } from "@/components/admin/rider-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { decrypt, decryptNullable } from "@/lib/crypto";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { RIDER_STATUSES } from "@/lib/fulfilment/riders";
import { VEHICLE_LABELS, type RiderVehicle } from "@/lib/fulfilment/rider-vehicles";
import { formatPrice } from "@/lib/money";
import { POOL_RIDER_STATUSES, POOL_STATUS_LABELS, type PoolRiderStatus } from "@/lib/riders/pool";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "TownMart riders" };
export const dynamic = "force-dynamic";

const local = (e164: string) => (e164.startsWith("+234") ? `0${e164.slice(4)}` : e164);
const TONE: Record<PoolRiderStatus, "warning" | "success" | "danger" | "secondary"> = { pending: "warning", approved: "success", suspended: "danger", rejected: "secondary" };

/** TownMart's own riders: applications to vet, and the riders on the road. */
export default async function AdminRidersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("rider.manage", "/admin/riders");
  const sp = await searchParams;
  const status: PoolRiderStatus = (POOL_RIDER_STATUSES as readonly string[]).includes(sp.status ?? "") ? (sp.status as PoolRiderStatus) : "pending";
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);

  const { counts, riders, held, done } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const grouped = await tx.rider.groupBy({ by: ["status"], where: { businessId: null }, _count: true });
    const riders = await tx.rider.findMany({ where: { businessId: null, status }, orderBy: status === "pending" ? { appliedAt: "asc" } : { name: "asc" }, take: 200 });
    const ids = riders.map((r) => r.id);
    const [held, done] = await Promise.all([
      tx.sellerOrder.groupBy({ by: ["riderId"], where: { riderId: { in: ids }, status: { in: [...RIDER_STATUSES] } }, _count: true }),
      tx.sellerOrder.groupBy({ by: ["riderId"], where: { riderId: { in: ids }, status: { in: ["delivered", "completed"] }, deliveredAt: { gte: monthAgo } }, _count: true, _sum: { riderPayKobo: true } }),
    ]);
    return { counts: new Map(grouped.map((g) => [g.status, g._count])), riders, held: new Map(held.map((h) => [h.riderId, h._count])), done: new Map(done.map((d) => [d.riderId, d])) };
  });

  return (
    <>
      <PageHeader title="TownMart riders" description="Riders who deliver for any shop. Call each applicant and their guarantor, and see their ID and vehicle papers, before approving." />
      <nav aria-label="Filter riders" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {POOL_RIDER_STATUSES.map((s) => (
          <Link key={s} href={`/admin/riders?status=${s}`} aria-current={status === s ? "page" : undefined} className={cn("rounded-xl border p-3", status === s ? "border-primary bg-primary-soft" : "hover:bg-muted")}>
            <p className="text-2xl font-bold tabular-nums">{counts.get(s) ?? 0}</p>
            <p className="text-sm text-muted-foreground">{POOL_STATUS_LABELS[s]}</p>
          </Link>
        ))}
      </nav>
      <Card className="overflow-hidden p-0">
        <CardContent className="p-0">
          {riders.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{status === "pending" ? "No applications waiting." : "No riders here."}</p>
          ) : (
            <ul className="divide-y">
              {riders.map((r) => {
                const phone = local(decrypt(r.phoneEncrypted));
                const g = r.guarantorPhoneEncrypted ? local(decrypt(r.guarantorPhoneEncrypted)) : null;
                const nin = decryptNullable(r.ninEncrypted);
                const d = done.get(r.id);
                return (
                  <li key={r.id} className="flex flex-col gap-3 p-4 text-sm lg:flex-row lg:items-start">
                    <div className="flex flex-1 flex-col gap-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {r.name}
                        <Badge variant={TONE[r.status as PoolRiderStatus]}>{POOL_STATUS_LABELS[r.status as PoolRiderStatus]}</Badge>
                        {r.status === "approved" && (r.isAvailable ? <Badge variant="success">Online</Badge> : <Badge variant="secondary">Offline</Badge>)}
                        {(held.get(r.id) ?? 0) > 0 && <Badge variant="info">{held.get(r.id)} in hand</Badge>}
                      </p>
                      <p className="text-muted-foreground">
                        <a href={`tel:${phone}`} className="text-primary underline">
                          {phone}
                        </a>{" "}
                        · {VEHICLE_LABELS[r.vehicle as RiderVehicle] ?? r.vehicle}
                        {r.plateNumber && ` · ${r.plateNumber}`}
                        {r.homeTown && ` · ${r.homeTown}`}
                      </p>
                      <p className="text-muted-foreground">
                        Guarantor: {r.guarantorName ?? "none"}
                        {g && (
                          <>
                            {" "}
                            ·{" "}
                            <a href={`tel:${g}`} className="text-primary underline">
                              {g}
                            </a>
                          </>
                        )}
                        {" · "}NIN: {nin ? `${nin.slice(0, 3)}••••${nin.slice(-4)}` : "not given"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {r.appliedAt && `Applied ${formatDateTime(r.appliedAt)}`}
                        {r.reviewedAt && ` · Reviewed ${formatDateTime(r.reviewedAt)}`}
                        {r.reviewNote && ` · “${r.reviewNote}”`}
                        {r.status === "approved" && ` · Last 30 days: ${d?._count ?? 0} delivered, ${formatPrice(d?._sum.riderPayKobo ?? 0n)} earned`}
                        {r.locationUpdatedAt && ` · Seen ${formatDateTime(r.locationUpdatedAt)}`}
                      </p>
                    </div>
                    <RiderReviewButtons id={r.id} status={r.status as PoolRiderStatus} />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
