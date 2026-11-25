import { NextResponse, type NextRequest } from "next/server";
import { localProvider } from "@/lib/storage/local-routes";

/** Local-driver stand-in for the public bucket. Only re-encoded WebP images live there. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ key: string[] }> }) {
  const provider = localProvider();
  if (provider instanceof NextResponse) return provider;
  const key = (await params).key.join("/");
  let body: Buffer | null;
  try {
    body = await provider.getObject("public", key);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!body) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(body), {
    headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
