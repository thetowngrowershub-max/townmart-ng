import { createHmac } from "node:crypto";
import { env } from "@/lib/env";
import { redis } from "@/lib/redis";
import type { PaymentProvider, StartPayment, VerifiedPayment, WebhookEvent } from "./provider";

/**
 * Development stand-in for a hosted payment page (refused in production by
 * lib/env). /checkout/pay/fake lets you approve or decline; the outcome is kept
 * in Redis for an hour and read back by verify(), like a real provider's API.
 */
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake" as const;

  async start(p: StartPayment) {
    await redis.set(`fakepay:${p.reference}`, JSON.stringify({ amountKobo: p.amountKobo.toString(), status: "pending", callbackUrl: p.callbackUrl }), "EX", 3600);
    return { redirectUrl: `${env().APP_URL}/checkout/pay/fake?reference=${encodeURIComponent(p.reference)}` };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    const raw = await redis.get(`fakepay:${reference}`);
    const s = raw ? (JSON.parse(raw) as { amountKobo: string; status: "pending" | "success" | "failed" }) : null;
    return {
      reference,
      status: s?.status ?? "abandoned",
      amountKobo: BigInt(s?.amountKobo ?? 0),
      currency: "NGN",
      channel: s?.status === "success" ? "card" : null,
      paidAt: s?.status === "success" ? new Date() : null,
      raw: s,
    };
  }

  static async settle(reference: string, outcome: "success" | "failed"): Promise<string | null> {
    const raw = await redis.get(`fakepay:${reference}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as { amountKobo: string; status: string; callbackUrl: string };
    await redis.set(`fakepay:${reference}`, JSON.stringify({ ...s, status: outcome }), "EX", 3600);
    return s.callbackUrl;
  }

  static async details(reference: string): Promise<{ amountKobo: bigint; status: string } | null> {
    const raw = await redis.get(`fakepay:${reference}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as { amountKobo: string; status: string };
    return { amountKobo: BigInt(s.amountKobo), status: s.status };
  }

  // Webhooks are signed with AUTH_SECRET so tests can exercise the same route.
  verifyWebhook(rawBody: string, headers: Headers): boolean {
    return headers.get("x-fake-signature") === createHmac("sha256", env().AUTH_SECRET).update(rawBody).digest("hex");
  }

  parseWebhook(rawBody: string): WebhookEvent {
    const body = JSON.parse(rawBody) as { id?: string; event?: string; reference?: string };
    return { eventId: body.id ?? "none", eventType: body.event ?? "unknown", reference: body.reference ?? null, isChargeSuccess: body.event === "charge.success", payload: body };
  }
}
