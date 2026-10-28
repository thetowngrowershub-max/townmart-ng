import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { PromotionStatusBadge } from "@/components/seller/promotion-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { promotionStatus } from "@/lib/promotions/promotions";
import { describeDiscount } from "@/lib/promotions/seller-queries";

export const metadata: Metadata = { title: "Platform promotions" };

export default async function PlatformPromotionsPage() {
  const user = await requirePermission("settings.manage", "/admin/catalogue/promotions");
  const rows = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const promotions = await tx.promotion.findMany({
      where: { businessId: null },
      orderBy: { endsAt: "desc" },
      take: 200,
      select: { id: true, name: true, discountType: true, discountValue: true, scope: true, startsAt: true, endsAt: true, isActive: true, usageLimit: true, redemptionCount: true, coupon: { select: { code: true } }, _count: { select: { targets: true } } },
    });
    const spent = await tx.promotionRedemption.groupBy({ by: ["promotionId"], where: { promotionId: { in: promotions.map((p) => p.id) } }, _sum: { discountKobo: true } });
    const cost = new Map(spent.map((s) => [s.promotionId, s._sum.discountKobo ?? 0n]));
    return promotions.map((p) => ({ ...p, cost: cost.get(p.id) ?? 0n }));
  });
  const now = new Date();
  const ORDER = { live: 0, scheduled: 1, paused: 2, used_up: 3, ended: 4 } as const;
  const list = rows.map((p) => ({ ...p, status: promotionStatus(p, now) })).sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <>
      <PageHeader
        title="Platform promotions"
        description="Sales TownMart runs and pays for, across every seller or whole categories. Sellers are paid as if there were no discount."
        actions={
          <Button asChild size="sm">
            <Link href="/admin/catalogue/promotions/new">
              <Plus aria-hidden /> New promotion
            </Link>
          </Button>
        }
      />
      {list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No platform promotions yet.</Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Promotion</th>
                <th scope="col" className="px-4 py-3 font-medium">Discount</th>
                <th scope="col" className="px-4 py-3 font-medium">Runs</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Uses</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Cost to TownMart</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {list.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">
                    <Link href={`/admin/catalogue/promotions/${p.id}`} className="font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {p.scope === "store" ? "Everything" : `${p._count.targets} categor${p._count.targets === 1 ? "y" : "ies"}`}
                      {p.coupon && <span className="ml-2 font-mono">Code {p.coupon.code}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{describeDiscount(p)}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-muted-foreground">
                    {formatDateTime(p.startsAt)}
                    <br />
                    to {formatDateTime(p.endsAt)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.redemptionCount}
                    {p.usageLimit !== null && <span className="text-muted-foreground"> / {p.usageLimit}</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatPrice(p.cost)}</td>
                  <td className="px-4 py-3">
                    <PromotionStatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
