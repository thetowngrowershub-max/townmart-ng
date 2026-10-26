import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { ProductForm } from "@/components/seller/product-form";
import { categoryOptions, EMPTY_PRODUCT } from "@/lib/seller/catalogue-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const ctx = await requireSellerPage("/dashboard/products/new", "listing.write");
  const categories = await withSellerRls(ctx, (tx) => categoryOptions(tx, "product"));
  return (
    <>
      <PageHeader title="Add product" />
      <ProductForm productId={null} categories={categories} initial={EMPTY_PRODUCT} />
    </>
  );
}
