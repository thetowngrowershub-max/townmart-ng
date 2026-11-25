import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { PromotionForm } from "@/components/seller/promotion-form";
import { emptyPromotion, promotionPickOptions } from "@/lib/promotions/seller-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "New promotion" };

export default async function NewPromotionPage() {
  const ctx = await requireSellerPage("/dashboard/promotions/new", "promotion.manage");
  const options = await withSellerRls(ctx, (tx) => promotionPickOptions(tx, ctx.business.id));
  return (
    <>
      <PageHeader title="New promotion" />
      <PromotionForm promotionId={null} initial={emptyPromotion()} redemptionCount={0} {...options} />
    </>
  );
}
