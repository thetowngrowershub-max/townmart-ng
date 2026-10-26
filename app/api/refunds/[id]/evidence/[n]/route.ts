import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { withSystemContext } from "@/lib/db";
import { findViewableOrder } from "@/lib/orders/access";
import { getSellerContext } from "@/lib/seller/context";
import { storage } from "@/lib/storage";

/**
 * Opens one photo attached to a refund request, for the customer (signed in
 * or with the order link), the seller it was sent to, or TownMart's finance
 * and dispute team. Redirects to a 60-second signed URL on the private bucket.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^\d$/.test(n)) return new NextResponse("Not found", { status: 404 });
  const refund = await withSystemContext((tx) => tx.refund.findUnique({ where: { id }, select: { evidenceKeys: true, businessId: true, order: { select: { orderNumber: true } } } }));
  const key = refund?.evidenceKeys[Number(n)];
  if (!refund || !key) return new NextResponse("Not found", { status: 404 });

  const user = await getCurrentUser();
  let allowed = !!user && (can(user, "finance.manage") || can(user, "dispute.manage"));
  if (!allowed && user && refund.businessId) {
    const seller = await getSellerContext();
    allowed = !!seller && seller.business.id === refund.businessId && can(seller.user, "order.read", { businessId: refund.businessId });
  }
  if (!allowed) allowed = (await findViewableOrder(refund.order.orderNumber, req.nextUrl.searchParams.get("t"))) !== null;
  // A refusal looks like a miss.
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  const url = await storage().createReadUrl("private", key, 60);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
