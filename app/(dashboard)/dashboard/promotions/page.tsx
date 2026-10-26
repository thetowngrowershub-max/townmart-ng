import { Plus, Zap } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { PromotionStatusBadge } from "@/components/seller/promotion-status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { promotionStatus } from "@/lib/promotions/promotions";
import { describeDiscount } from "@/lib/promotions/seller-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Promotions" };

const SCOPE = { store: "Whole store", product: "1 product", products: "Products", category: "Categories", service: "Services" } as const;

export default async function PromotionsPage() {
  const ctx = await requireSellerPage("/dashboard/promotions", "promotion.manage");
  const rows = await withSellerRls(ctx, (tx) =>
    tx.promotion.findMany({
      where: { businessId: ctx.business.id },
      orderBy: [{ endsAt: "desc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        discountType: true,
        discountValue: true,
        scope: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
        isFlashDeal: true,
        usageLimit: true,
        redemptionCount: true,
        coupon: { select: { code: true } },
        _count: { select: { targets: true } },
      },
    }),
  );
  const now = new Date();
  const ORDER = { live: 0, scheduled: 1, paused: 2, used_up: 3, ended: 4 } as const;
  const list = rows.map((p) => ({ ...p, status: promotionStatus(p, now) })).sort((a, b) => ORDER[a.status] - ORDER[b.status]);

  return (
    <>
      <PageHeader
        title="Promotions"
        description="Discounts, flash deals and coupon codes for your store. Shoppers see the real price and end date."
        actions={
          <Button asChild size="sm">
            <Link href="/dashboard/promotions/new">
              <Plus aria-hidden /> New promotion
            </Link>
          </Button>
        }
      />
      {list.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">No promotions yet. Run a sale on your whole store, a category, or a few products.</Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">Promotion</th>
                  <th scope="col" className="px-4 py-3 font-medium">Discount</th>
                  <th scope="col" className="px-4 py-3 font-medium">Applies to</th>
                  <th scope="col" className="px-4 py-3 font-medium">Runs</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Uses</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {list.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/promotions/${p.id}`} className="font-medium hover:underline">
                        {p.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {p.isFlashDeal && (
                          <span className="inline-flex items-center gap-1 text-danger">
                            <Zap className="size-3" aria-hidden /> Flash deal
                          </span>
                        )}
                        {p.coupon && <span className="font-mono">Code {p.coupon.code.toUpperCase()}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{describeDiscount(p)}</td>
                    <td className="px-4 py-3">{p.scope === "store" ? SCOPE.store : `${SCOPE[p.scope]}${p.scope === "product" ? "" : ` (${p._count.targets})`}`}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(p.startsAt)}
                      <br />
                      to {formatDateTime(p.endsAt)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {p.redemptionCount}
                      {p.usageLimit !== null && <span className="text-muted-foreground"> / {p.usageLimit}</span>}
                    </td>
                    <td className="px-4 py-3">
                      <PromotionStatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
