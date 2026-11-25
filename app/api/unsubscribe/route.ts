import { NextResponse, type NextRequest } from "next/server";
import { withSystemContext } from "@/lib/db";
import { unsubscribe, verifyUnsubscribe } from "@/lib/marketing";

/** One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header. */
export async function POST(req: NextRequest) {
  const email = verifyUnsubscribe(req.nextUrl.searchParams.get("e"), req.nextUrl.searchParams.get("t"));
  if (!email) return new NextResponse("Invalid link", { status: 400 });
  await withSystemContext((tx) => unsubscribe(tx, email, "one_click"));
  return new NextResponse(null, { status: 204 });
}
