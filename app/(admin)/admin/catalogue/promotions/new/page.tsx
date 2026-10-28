import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { PromotionForm } from "@/components/seller/promotion-form";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { emptyPromotion, platformPickOptions } from "@/lib/promotions/seller-queries";

export const metadata: Metadata = { title: "New platform promotion" };

export default async function NewPlatformPromotionPage() {
  const user = await requirePermission("settings.manage", "/admin/catalogue/promotions/new");
  const options = await withRls({ scope: "admin", userId: user.id }, (tx) => platformPickOptions(tx));
  return (
    <>
      <PageHeader title="New platform promotion" />
      <PromotionForm promotionId={null} initial={emptyPromotion()} redemptionCount={0} platform {...options} />
    </>
  );
}
