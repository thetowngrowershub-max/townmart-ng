import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { StockAdjustForm } from "@/components/seller/stock-adjust-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/datetime";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Stock log" };

const REASONS: Record<string, string> = {
  sale: "Sale",
  reservation: "Reserved at checkout",
  release: "Reservation released",
  refund_restock: "Refund restock",
  manual_adjustment: "Manual adjustment",
  import: "CSV import",
};

export default async function StockLogPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireSellerPage(`/dashboard/products/${id}/stock`, "listing.write");
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const product = await withSellerRls(ctx, (tx) =>
    tx.product.findFirst({
      where: { id, businessId: ctx.business.id, deletedAt: null },
      select: {
        title: true,
        unit: true,
        variants: {
          orderBy: { position: "asc" },
          select: {
            id: true,
            sku: true,
            optionValues: true,
            stockQty: true,
            stockMovements: { orderBy: { createdAt: "desc" }, take: 100 },
          },
        },
      },
    }),
  );
  if (!product) notFound();

  const label = (v: (typeof product.variants)[number]) => {
    const values = Object.values((v.optionValues ?? {}) as Record<string, string>).join(" / ");
    return values ? `${values} · ${v.sku}` : v.sku;
  };
  const labelById = new Map(product.variants.map((v) => [v.id, label(v)]));
  const movements = product.variants
    .flatMap((v) => v.stockMovements)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 100);

  return (
    <>
      <PageHeader
        title={`Stock: ${product.title}`}
        actions={
          <Link href={`/dashboard/products/${id}`} className="text-sm text-primary underline">
            Back to product
          </Link>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Adjust stock</CardTitle>
          </CardHeader>
          <CardContent>
            <StockAdjustForm variants={product.variants.map((v) => ({ id: v.id, label: label(v), stock: `${v.stockQty.toString()} ${product.unit}` }))} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No stock changes yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pr-3">When</th>
                      <th scope="col" className="py-2 pr-3">Variant</th>
                      <th scope="col" className="py-2 pr-3">Why</th>
                      <th scope="col" className="py-2 pr-3 text-right">Change</th>
                      <th scope="col" className="py-2 text-right">After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {movements.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(m.createdAt)}</td>
                        <td className="py-2 pr-3">{labelById.get(m.variantId)}</td>
                        <td className="py-2 pr-3">
                          {REASONS[m.reason] ?? m.reason}
                          {m.note && <span className="block text-xs text-muted-foreground">{m.note}</span>}
                        </td>
                        <td className={`py-2 pr-3 text-right font-mono ${m.changeQty.isNegative() ? "text-danger" : "text-success"}`}>
                          {m.changeQty.isNegative() ? "" : "+"}
                          {m.changeQty.toString()}
                        </td>
                        <td className="py-2 text-right font-mono">{m.balanceAfter.toString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
