import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { withRls } from "@/lib/db";
import { requestMeta } from "@/lib/request";
import { storage } from "@/lib/storage";

/**
 * Opens one KYC document: checks permission, records the view in the audit
 * log, then redirects to a 60-second signed URL on the private bucket.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ businessId: string; index: string }> }) {
  const { businessId, index } = await params;
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Sign in required", { status: 401 });
  if (!can(user, "kyc.document.view")) return new NextResponse("Not allowed", { status: 403 });
  if (!/^[0-9a-f-]{36}$/i.test(businessId) || !/^\d$/.test(index)) return new NextResponse("Not found", { status: 404 });

  const meta = await requestMeta();
  const key = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const kyc = await tx.businessKyc.findUnique({ where: { businessId }, select: { documentKeys: true } });
    const k = kyc?.documentKeys[Number(index)];
    if (k) {
      await writeAudit(tx, { actorUserId: user.id, action: "kyc.document_viewed", entityType: "business", entityId: businessId, after: { document: Number(index) }, ipHash: meta.ipHash });
    }
    return k;
  });
  if (!key) return new NextResponse("Not found", { status: 404 });

  const url = await storage().createReadUrl("private", key, 60);
  return NextResponse.redirect(url, { status: 303, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
