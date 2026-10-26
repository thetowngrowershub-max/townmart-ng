import { NextResponse, type NextRequest } from "next/server";
import { localProvider, notAllowed, parseBucket } from "@/lib/storage/local-routes";

/** Local-driver stand-in for an S3 presigned GET (private objects). */
export async function GET(req: NextRequest) {
  const provider = localProvider();
  if (provider instanceof NextResponse) return provider;
  const q = req.nextUrl.searchParams;
  const bucket = parseBucket(q.get("bucket"));
  const [key, exp, sig] = ["key", "exp", "sig"].map((k) => q.get(k) ?? "");
  if (!bucket || !key || Number(exp) < Date.now() / 1000 || !provider.verify(["get", bucket, key!, exp!], sig!)) {
    return notAllowed();
  }
  const body = await provider.getObject(bucket, key!);
  if (!body) return new NextResponse("Not found", { status: 404 });
  const type = key!.endsWith(".pdf") ? "application/pdf" : key!.endsWith(".csv") ? "text/csv" : key!.endsWith(".webp") ? "image/webp" : "image/jpeg";
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": type, "Cache-Control": "private, no-store", "Content-Disposition": "inline" },
  });
}
