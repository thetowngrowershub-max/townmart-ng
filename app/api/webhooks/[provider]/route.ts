import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { paymentProvider, type ProviderName } from "@/lib/payments";
import { enqueueOrderEvent } from "@/lib/queue";
import { env } from "@/lib/env";

const PROVIDERS: ProviderName[] = ["paystack", "flutterwave", "fake"];

/**
 * Payment webhooks. Every delivery is stored (payment_events) with whether its
 * signature checked out; the unique (provider, event id) makes repeats no-ops.
 * Valid events are processed by the worker, which confirms the payment with
 * the provider's verify API: the webhook body itself is never trusted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const name = (await params).provider as ProviderName;
  if (!PROVIDERS.includes(name) || (name === "fake" && env().NODE_ENV === "production")) return new NextResponse(null, { status: 404 });

  const raw = await request.text();
  if (raw.length > 256_000) return new NextResponse(null, { status: 413 });

  let provider;
  try {
    provider = paymentProvider(name);
  } catch {
    // Not configured here: nothing could be verified.
    return new NextResponse(null, { status: 404 });
  }

  const valid = provider.verifyWebhook(raw, request.headers);
  let event;
  try {
    event = provider.parseWebhook(raw);
  } catch {
    logger.warn({ provider: name, valid }, "unparseable payment webhook");
    return new NextResponse(null, { status: 400 });
  }

  const stored = await withSystemContext(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO payment_events (provider, event_type, provider_event_id, reference, signature_valid, payload)
      VALUES (${name}::payment_provider, ${event.eventType}, ${valid ? event.eventId : `invalid:${crypto.randomUUID()}`}, ${event.reference},
              ${valid}, ${JSON.stringify(event.payload)}::jsonb)
      ON CONFLICT (provider, provider_event_id) DO NOTHING
      RETURNING id`;
    return rows[0]?.id ?? null;
  }).catch((err: unknown) => {
    if (err instanceof Prisma.PrismaClientKnownRequestError) logger.error({ err }, "storing payment webhook failed");
    throw err;
  });

  if (!valid) {
    logger.warn({ provider: name, eventType: event.eventType }, "payment webhook with a bad signature");
    return new NextResponse(null, { status: 401 });
  }
  // A repeat delivery: acknowledged, nothing more to do.
  if (!stored) return NextResponse.json({ ok: true, duplicate: true });

  if (event.isChargeSuccess || event.reference || event.transferReference) await enqueueOrderEvent({ kind: "payment.event", eventId: stored });
  return NextResponse.json({ ok: true });
}
