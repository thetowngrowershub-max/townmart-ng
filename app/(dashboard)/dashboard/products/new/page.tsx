import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { ProductForm } from "@/components/seller/product-form";
import { categoryOptions, EMPTY_PRODUCT, productAttributeDefs } from "@/lib/seller/catalogue-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  const ctx = await requireSellerPage("/dashboard/products/new", "listing.write");
  const { categories, attributeDefs } = await withSellerRls(ctx, async (tx) => ({ categories: await categoryOptions(tx, "product"), attributeDefs: await productAttributeDefs(tx) }));
  return (
    <>
      <PageHeader title="Add product" />
      <ProductForm productId={null} categories={categories} attributeDefs={attributeDefs} initial={EMPTY_PRODUCT} />
    </>
  );
}
