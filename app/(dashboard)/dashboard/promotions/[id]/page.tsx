import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { PromotionActions } from "@/components/seller/promotion-actions";
import { PromotionForm } from "@/components/seller/promotion-form";
import { PromotionStatusBadge } from "@/components/seller/promotion-status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { formatPrice } from "@/lib/money";
import { promotionStatus } from "@/lib/promotions/promotions";
import { describeDiscount, promotionEditSelect, promotionPickOptions, promotionToFormValues } from "@/lib/promotions/seller-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Edit promotion" };

function timeLeft(ms: number) {
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h} hour${h === 1 ? "" : "s"} left`;
  return "Less than an hour left";
}

export default async function EditPromotionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const ctx = await requireSellerPage(`/dashboard/promotions/${id}`, "promotion.manage");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withSellerRls(ctx, async (tx) => {
    const promotion = await tx.promotion.findFirst({ where: { id, businessId: ctx.business.id }, select: promotionEditSelect });
    if (!promotion) return null;
    const [totals, customers, options] = await Promise.all([
      tx.promotionRedemption.aggregate({ where: { promotionId: id }, _sum: { discountKobo: true }, _count: true }),
      tx.promotionRedemption.findMany({ where: { promotionId: id, userId: { not: null } }, distinct: ["userId"], select: { userId: true } }),
      promotionPickOptions(tx, ctx.business.id),
    ]);
    return { promotion, totals, customers: customers.length, options };
  });
  if (!data) notFound();
  const { promotion: p, totals, options } = data;
  const now = new Date();
  const status = promotionStatus(p, now);
  const covered =
    p.scope === "store" ? "Whole store" : `${p.targets.length} ${p.scope === "category" ? "categor" : p.scope === "service" ? "service" : "product"}${p.scope === "category" ? (p.targets.length === 1 ? "y" : "ies") : p.targets.length === 1 ? "" : "s"}`;
  const when =
    status === "scheduled" ? `Starts ${formatDateTime(p.startsAt)}` : status === "live" ? timeLeft(p.endsAt.getTime() - now.getTime()) : `Ends ${formatDateTime(p.endsAt)}`;

  const tiles = [
    { label: "Orders", value: totals._count.toString() },
    { label: "Total discount given", value: formatPrice(totals._sum.discountKobo ?? 0n) },
    { label: "Customers", value: data.customers.toString() },
    { label: "Applies to", value: covered },
  ];

  return (
    <>
      <PageHeader
        title={p.name}
        description={describeDiscount(p)}
        actions={<PromotionActions id={p.id} status={status} used={p.redemptionCount > 0} />}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <PromotionStatusBadge status={status} />
        <span className="text-muted-foreground">{when}</span>
      </div>
      <dl className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="p-4">
              <dt className="text-xs text-muted-foreground">{t.label}</dt>
              <dd className="mt-1 text-lg font-semibold tabular-nums">{t.value}</dd>
            </CardContent>
          </Card>
        ))}
      </dl>
      {saved === "1" && <Alert variant="success" className="mb-6">Promotion saved.</Alert>}
      <PromotionForm promotionId={p.id} initial={promotionToFormValues(p)} redemptionCount={p.redemptionCount} {...options} />
    </>
  );
}
