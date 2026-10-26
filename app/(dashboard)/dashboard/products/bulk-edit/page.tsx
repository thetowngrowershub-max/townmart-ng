import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { BulkEditTable } from "@/components/seller/bulk-edit-table";
import { koboToNairaString } from "@/lib/money";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Bulk edit" };

export default async function BulkEditPage() {
  const ctx = await requireSellerPage("/dashboard/products/bulk-edit", "listing.write");
  const variants = await withSellerRls(ctx, (tx) =>
    tx.productVariant.findMany({
      where: { businessId: ctx.business.id, product: { deletedAt: null } },
      orderBy: [{ product: { title: "asc" } }, { position: "asc" }],
      take: 500,
      select: { id: true, sku: true, optionValues: true, priceKobo: true, stockQty: true, product: { select: { title: true, trackInventory: true } } },
    }),
  );
  return (
    <>
      <PageHeader
        title="Bulk edit prices and stock"
        description="Stock changes are recorded in each product's stock log. For more than 500 variants, use CSV import."
        actions={
          <Link href="/dashboard/products" className="text-sm text-primary underline">
            Back to products
          </Link>
        }
      />
      <BulkEditTable
        rows={variants.map((v) => ({
          variantId: v.id,
          product: v.product.title,
          variant: Object.values((v.optionValues ?? {}) as Record<string, string>).join(" / "),
          sku: v.sku,
          price: koboToNairaString(v.priceKobo),
          stockQty: v.stockQty.toString(),
          tracked: v.product.trackInventory,
        }))}
      />
    </>
  );
}
