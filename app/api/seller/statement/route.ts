import { NextResponse, type NextRequest } from "next/server";
import { can } from "@/lib/authz";
import { buildStatement, statementCsv } from "@/lib/payouts/statement";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { statementMonthSchema } from "@/lib/validation/refunds";

/** A month's statement as CSV, for the signed-in seller's own business. */
export async function GET(req: NextRequest) {
  const ctx = await getSellerContext();
  if (!ctx) return new NextResponse("Sign in required", { status: 401 });
  if (!can(ctx.user, "payout.manage", { businessId: ctx.business.id })) return new NextResponse("Not allowed", { status: 403 });
  const month = statementMonthSchema.safeParse(req.nextUrl.searchParams.get("month"));
  if (!month.success) return new NextResponse("Choose a month", { status: 400 });
  const s = await withSellerRls(ctx, (tx) => buildStatement(tx, ctx.business.id, month.data));
  if (!s) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(statementCsv(s, ctx.business.name), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="townmart-statement-${ctx.business.slug}-${month.data}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
