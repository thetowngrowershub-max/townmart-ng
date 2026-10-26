import { ExternalLink, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { DeleteListingButton } from "@/components/seller/delete-listing-button";
import { ProductForm } from "@/components/seller/product-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { categoryOptions, productToFormValues } from "@/lib/seller/catalogue-queries";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/products/${id}`, "listing.write");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { product, categories } = await withSellerRls(ctx, async (tx) => ({
    product: await tx.product.findFirst({
      where: { id, businessId: ctx.business.id, deletedAt: null },
      include: { options: true, variants: true, images: true },
    }),
    categories: await categoryOptions(tx, "product"),
  }));
  if (!product) notFound();
  const live = product.status === "active" && ctx.business.status === "approved";

  return (
    <>
      <PageHeader
        title={product.title}
        actions={
          <div className="flex flex-wrap gap-2">
            {live && (
              <Button asChild variant="outline" size="sm">
                <Link href={`/p/${product.slug}`} target="_blank">
                  <ExternalLink aria-hidden /> View
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="sm">
              <Link href={`/dashboard/products/${id}/stock`}>
                <History aria-hidden /> Stock log
              </Link>
            </Button>
            <DeleteListingButton kind="product" id={id} />
          </div>
        }
      />
      {(await searchParams).saved && <Alert variant="success" className="mb-4">Product created.</Alert>}
      <ProductForm productId={id} categories={categories} initial={productToFormValues(product)} />
    </>
  );
}
