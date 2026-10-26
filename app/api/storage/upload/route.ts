import { NextResponse, type NextRequest } from "next/server";
import { localProvider, notAllowed, parseBucket } from "@/lib/storage/local-routes";
import { MAX_IMAGE_BYTES } from "@/lib/storage/uploads";

/** Local-driver stand-in for an S3 presigned PUT. */
export async function PUT(req: NextRequest) {
  const provider = localProvider();
  if (provider instanceof NextResponse) return provider;
  const q = req.nextUrl.searchParams;
  const bucket = parseBucket(q.get("bucket"));
  const [key, ct, exp, sig] = ["key", "ct", "exp", "sig"].map((k) => q.get(k) ?? "");
  if (!bucket || !key || !sig || Number(exp) < Date.now() / 1000) return notAllowed();
  if (!provider.verify(["put", bucket, key!, ct!, exp!], sig!)) return notAllowed();
  if (req.headers.get("content-type") !== ct) return notAllowed();

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length > MAX_IMAGE_BYTES) return new NextResponse("Too large", { status: 413 });
  await provider.putObject(bucket, key!, body);
  return new NextResponse(null, { status: 200 });
}
