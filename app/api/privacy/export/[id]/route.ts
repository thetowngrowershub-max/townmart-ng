import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { verifyExportLink } from "@/lib/privacy/export";
import { storage } from "@/lib/storage";

/**
 * Downloads a data export. Needs both the signed link from the email or the
 * Privacy Centre (valid until the export expires) and the account holder
 * signed in, so a forwarded link alone opens nothing.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = req.nextUrl.searchParams;
  const file = q.get("f") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id) || !verifyExportLink(id, file, q.get("exp"), q.get("sig"))) {
    return new NextResponse("This download link has expired or isn't valid. Ask for a new copy from your Privacy Centre.", { status: 410 });
  }
  const user = await getCurrentUser();
  if (!user) {
    const next = `${req.nextUrl.pathname}${req.nextUrl.search}`;
    return NextResponse.redirect(new URL(`/auth/sign-in?next=${encodeURIComponent(next)}`, req.url), 303);
  }
  // RLS: people only see their own requests.
  const r = await withRls({ userId: user.id }, (tx) => tx.dataSubjectRequest.findFirst({ where: { id, userId: user.id }, select: { exportJsonKey: true, exportPdfKey: true, reference: true } }));
  const key = file === "json" ? r?.exportJsonKey : r?.exportPdfKey;
  if (!r || !key) return new NextResponse("Not found", { status: 404 });
  const body = await storage().getObject("private", key);
  if (!body) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": file === "json" ? "application/json" : "application/pdf",
      "Content-Disposition": `attachment; filename="townmart-data-${r.reference}.${file}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
