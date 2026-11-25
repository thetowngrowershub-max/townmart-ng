import { NextResponse } from "next/server";
import { can } from "@/lib/authz";
import { productsToCsv } from "@/lib/catalogue/csv";
import { htmlToText } from "@/lib/sanitize";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";

/** Downloads the seller's products in the import format. */
export async function GET() {
  const ctx = await getSellerContext();
  if (!ctx) return new NextResponse("Sign in required", { status: 401 });
  if (!can(ctx.user, "listing.read", { businessId: ctx.business.id })) return new NextResponse("Not allowed", { status: 403 });

  const products = await withSellerRls(ctx, (tx) =>
    tx.product.findMany({
      where: { businessId: ctx.business.id, deletedAt: null },
      orderBy: { createdAt: "asc" },
      include: { category: { select: { slug: true } }, options: true, variants: true },
    }),
  );
  const csv = productsToCsv(products.map((p) => ({ ...p, descriptionText: htmlToText(p.descriptionHtml) })));
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="townmart-products-${ctx.business.slug}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
