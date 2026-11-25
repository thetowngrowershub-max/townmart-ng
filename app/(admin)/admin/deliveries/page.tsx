import { AlertTriangle, Bike, MapPin, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AutoRefresh } from "@/components/admin/auto-refresh";
import { PoolDeliveryActions } from "@/components/admin/pool-delivery-actions";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { deliveryActivity, deliveryBoard, LATE_AFTER_MS, STAGE_LABELS, type DeliveryStage } from "@/lib/admin/deliveries";
import { requirePermission } from "@/lib/auth/current-user";
import { decrypt } from "@/lib/crypto";
import { withRls } from "@/lib/db";
import { poolCandidates } from "@/lib/riders/pool";
import { getCheckoutSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Deliveries" };
export const dynamic = "force-dynamic";

const STAGES = Object.keys(STAGE_LABELS) as DeliveryStage[];
const STAGE_TONE: Record<DeliveryStage, "warning" | "info" | "default" | "success"> = { needs_rider: "warning", assigned: "info", on_the_way: "default", delivered: "success" };

function waited(since: Date, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Every delivery on the go: who has it, how long it has waited, and what just happened. Refreshes itself every minute. */
export default async function AdminDeliveriesPage({ searchParams }: { searchParams: Promise<{ stage?: string; late?: string }> }) {
  const user = await requirePermission("dispute.manage", "/admin/deliveries");
  const sp = await searchParams;
  const stage = sp.stage && sp.stage in STAGE_LABELS ? (sp.stage as DeliveryStage) : null;
  const lateOnly = sp.late === "1";
  const now = new Date();
  const { board, activity, pool } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const s = await getCheckoutSettings(tx);
    return { board: await deliveryBoard(tx, now), activity: await deliveryActivity(tx), pool: await poolCandidates(tx, null, s.riderPoolMaxJobs, now) };
  });
  const poolOptions = pool.map((r) => ({ id: r.id, label: `${r.name} (${decrypt(r.phoneEncrypted)})${r.activeJobs > 0 ? `, ${r.activeJobs} in hand` : ""}` }));
  const rows = board.rows.filter((r) => (!stage || r.stage === stage) && (!lateOnly || r.late));
  const hours = (ms: number) => ms / 3600_000;

  return (
    <>
      <AutoRefresh seconds={60} />
      <PageHeader title="Deliveries" description={`Every delivery on the go, updated each minute. Late means no rider after ${hours(LATE_AFTER_MS.needs_rider)} h, not picked up ${hours(LATE_AFTER_MS.assigned)} h after assigning, or on the way over ${hours(LATE_AFTER_MS.on_the_way)} h.`} />

      <nav aria-label="Filter deliveries" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Link href="/admin/deliveries?late=1" aria-current={lateOnly ? "page" : undefined} className={cn("rounded-xl border p-3", lateOnly ? "border-danger bg-danger/10" : "hover:bg-muted", board.counts.late > 0 && "border-danger")}>
          <p className="text-2xl font-bold tabular-nums">{board.counts.late}</p>
          <p className="flex items-center gap-1 text-sm text-muted-foreground">
            <AlertTriangle className="size-4 text-danger" aria-hidden /> Late
          </p>
        </Link>
        {STAGES.map((s) => (
          <Link key={s} href={stage === s ? "/admin/deliveries" : `/admin/deliveries?stage=${s}`} aria-current={stage === s ? "page" : undefined} className={cn("rounded-xl border p-3", stage === s ? "border-primary bg-primary-soft" : "hover:bg-muted")}>
            <p className="text-2xl font-bold tabular-nums">{board.counts[s]}</p>
            <p className="text-sm text-muted-foreground">{STAGE_LABELS[s]}</p>
          </Link>
        ))}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[2fr_1fr]">
        <Card className="overflow-hidden p-0">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">{stage || lateOnly ? "Nothing here right now." : "No deliveries on the go."}</p>
          ) : (
            <ul className="divide-y">
              {rows.map((r) => (
                <li key={r.sellerOrderId} className={cn("flex flex-col gap-2 px-4 py-3 text-sm", r.late && "bg-danger/5")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/admin/orders/${r.orderNumber}`} className="font-medium hover:underline">
                        {r.orderNumber}
                      </Link>{" "}
                      <span className="text-muted-foreground">
                        · {r.shop}
                        {r.area && ` → ${r.area}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.payOnDelivery && <Badge variant="outline">Pay on delivery</Badge>}
                      {r.late && <Badge variant="danger">Late</Badge>}
                      <Badge variant={STAGE_TONE[r.stage]}>{STAGE_LABELS[r.stage]}</Badge>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground">
                    {r.rider ? (
                      <>
                        <span className="flex items-center gap-1 text-foreground">
                          <Bike className="size-4" aria-hidden /> {r.rider.name}
                          {r.rider.townmart && <Badge variant="info">TownMart rider</Badge>}
                        </span>
                        <a href={`tel:${r.rider.phone}`} className="flex items-center gap-1 text-primary underline">
                          <Phone className="size-3.5" aria-hidden /> {r.rider.phone}
                        </a>
                        {r.rider.mapUrl ? (
                          <a href={r.rider.mapUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-primary underline">
                            <MapPin className="size-3.5" aria-hidden /> Seen {r.rider.seen}
                          </a>
                        ) : (
                          <span>Location not shared</span>
                        )}
                      </>
                    ) : (
                      <span>{r.stage === "needs_rider" ? (r.pooled ? "Offered to TownMart riders, no one has taken it yet" : "No rider yet (the shop uses its own riders)") : "No rider (the shop sent it another way)"}</span>
                    )}
                    {r.stage !== "delivered" && <span>Waiting {waited(r.since, now)}</span>}
                  </div>
                  <p className="text-xs text-muted-foreground">{r.times.map((t) => `${t.label} ${t.at}`).join(" · ")}</p>
                  {r.canAssignPool && (r.stage === "needs_rider" || r.rider?.townmart) && <PoolDeliveryActions sellerOrderId={r.sellerOrderId} riders={poolOptions} canOffer={!r.rider} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet.</p>
            ) : (
              <ol className="flex flex-col gap-3 text-sm">
                {activity.map((a) => (
                  <li key={a.id}>
                    <p>
                      <Link href={`/admin/orders/${a.orderNumber}`} className="font-medium hover:underline">
                        {a.orderNumber}
                      </Link>{" "}
                      {a.text}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {a.shop} · {a.at}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
