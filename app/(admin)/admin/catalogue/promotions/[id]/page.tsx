import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { PromotionActions } from "@/components/seller/promotion-actions";
import { PromotionForm } from "@/components/seller/promotion-form";
import { PromotionStatusBadge } from "@/components/seller/promotion-status-badge";
import { Alert } from "@/components/ui/alert";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { promotionStatus } from "@/lib/promotions/promotions";
import { describeDiscount, platformPickOptions, promotionEditSelect, promotionToFormValues } from "@/lib/promotions/seller-queries";

export const metadata: Metadata = { title: "Platform promotion" };

export default async function PlatformPromotionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { saved } = await searchParams;
  const user = await requirePermission("settings.manage", `/admin/catalogue/promotions/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const promotion = await tx.promotion.findFirst({ where: { id, businessId: null }, select: promotionEditSelect });
    if (!promotion) return null;
    const [totals, options] = await Promise.all([tx.promotionRedemption.aggregate({ where: { promotionId: id }, _sum: { discountKobo: true }, _count: true }), platformPickOptions(tx)]);
    return { promotion, totals, options };
  });
  if (!data) notFound();
  const p = data.promotion;
  const status = promotionStatus(p);

  return (
    <>
      <PageHeader title={p.name} description={describeDiscount(p)} actions={<PromotionActions id={p.id} status={status} used={p.redemptionCount > 0} platform />} />
      <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
        <PromotionStatusBadge status={status} />
        <span className="text-muted-foreground">
          {formatDateTime(p.startsAt)} to {formatDateTime(p.endsAt)} · {data.totals._count} order{data.totals._count === 1 ? "" : "s"} · {formatPrice(data.totals._sum.discountKobo ?? 0n)} paid by TownMart
        </span>
      </div>
      {saved === "1" && (
        <Alert variant="success" className="mb-6">
          Promotion saved.
        </Alert>
      )}
      <PromotionForm promotionId={p.id} initial={promotionToFormValues(p)} redemptionCount={p.redemptionCount} platform {...data.options} />
    </>
  );
}
