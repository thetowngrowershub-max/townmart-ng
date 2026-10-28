import { Download, FileUp, Plus, Table2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { ListingTable } from "@/components/seller/listing-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Prisma } from "@prisma/client";
import { formatPrice } from "@/lib/money";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { publicImageUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Products" };

const STATUSES = ["all", "active", "draft", "archived"] as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; stock?: string }> }) {
  const ctx = await requireSellerPage("/dashboard/products", "listing.read");
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === sp.status) ?? "all";
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const lowOnly = sp.stock === "low";

  const products = await withSellerRls(ctx, async (tx) => {
    // Variants at or below their own threshold, compared in SQL.
    const lowIds = lowOnly
      ? (
          await tx.$queryRaw<{ product_id: string }[]>`
            SELECT DISTINCT product_id FROM product_variants
             WHERE business_id = ${ctx.business.id}::uuid AND stock_qty <= low_stock_threshold`
        ).map((r) => r.product_id)
      : null;
    return tx.product.findMany({
      where: {
        businessId: ctx.business.id,
        deletedAt: null,
        ...(status !== "all" ? { status } : {}),
        ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { variants: { some: { sku: { contains: q, mode: "insensitive" } } } }] } : {}),
        ...(lowIds ? { id: { in: lowIds }, trackInventory: true } : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: {
        id: true,
        title: true,
        status: true,
        takenDownAt: true,
        basePriceKobo: true,
        trackInventory: true,
        unit: true,
        images: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], take: 1, select: { storageKey: true } },
        variants: { select: { stockQty: true, lowStockThreshold: true } },
      },
    });
  });

  const rows = products.map((p) => {
    const stock = p.variants.reduce((sum, v) => sum.plus(v.stockQty), new Prisma.Decimal(0));
    const low = p.trackInventory && p.variants.some((v) => v.stockQty.lte(v.lowStockThreshold));
    return {
      id: p.id,
      title: p.title,
      href: `/dashboard/products/${p.id}`,
      imageUrl: p.images[0] ? publicImageUrl(p.images[0].storageKey) : null,
      price: `${p.variants.length > 1 ? "From " : ""}${formatPrice(p.basePriceKobo)}`,
      status: p.status,
      detail: p.trackInventory ? `${stock.toString()} ${p.unit} across ${p.variants.length} variant${p.variants.length === 1 ? "" : "s"}` : "Not tracked",
      warning: p.takenDownAt ? "Taken down by TownMart" : low ? "Low stock" : undefined,
    };
  });

  const tab = (s: (typeof STATUSES)[number]) => `/dashboard/products?${new URLSearchParams({ ...(q ? { q } : {}), ...(s !== "all" ? { status: s } : {}) })}`;

  return (
    <>
      <PageHeader
        title="Products"
        description={ctx.business.status === "approved" ? undefined : "Active products go live once your store is approved."}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/products/bulk-edit">
                <Table2 aria-hidden /> Bulk edit
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/products/import">
                <FileUp aria-hidden /> Import CSV
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <a href="/api/seller/products/export">
                <Download aria-hidden /> Export CSV
              </a>
            </Button>
            <Button asChild size="sm">
              <Link href="/dashboard/products/new">
                <Plus aria-hidden /> Add product
              </Link>
            </Button>
          </div>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Filter by status" className="flex gap-2">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={tab(s)}
              aria-current={s === status && !lowOnly ? "page" : undefined}
              className={cn("rounded-full border px-3 py-1.5 text-sm capitalize", s === status && !lowOnly ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
            >
              {s}
            </Link>
          ))}
          <Link
            href="/dashboard/products?stock=low"
            aria-current={lowOnly ? "page" : undefined}
            className={cn("rounded-full border px-3 py-1.5 text-sm", lowOnly ? "border-warning bg-warning/10 font-semibold" : "hover:bg-muted")}
          >
            Low stock
          </Link>
        </nav>
        <form className="ml-auto" role="search">
          <label htmlFor="product-search" className="sr-only">
            Search products
          </label>
          <Input id="product-search" name="q" defaultValue={q} placeholder="Search title or SKU" className="h-9 w-56" />
          {status !== "all" && <input type="hidden" name="status" value={status} />}
        </form>
      </div>
      {rows.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {q || status !== "all" || lowOnly ? "No products match." : "No products yet. Add your first product or import a CSV."}
        </Card>
      ) : (
        <ListingTable kind="product" rows={rows} />
      )}
    </>
  );
}
