import { createHmac, timingSafeEqual } from "node:crypto";
import { PaymentProviderError, type PaymentProvider, type ProviderRefund, type StartPayment, type StartRefund, type VerifiedPayment, type WebhookEvent } from "./provider";

type Res<T> = { status: boolean; message: string; data: T };

export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack" as const;
  constructor(private readonly secretKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<Res<T>> {
    const res = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as Res<T> | null;
    if (!body) throw new PaymentProviderError(`Paystack ${path}: HTTP ${res.status}`);
    return body;
  }

  async start(p: StartPayment) {
    const res = await this.call<{ authorization_url: string }>("/transaction/initialize", {
      method: "POST",
      body: JSON.stringify({
        email: p.email,
        amount: p.amountKobo.toString(),
        currency: "NGN",
        reference: p.reference,
        callback_url: p.callbackUrl,
        metadata: { description: p.description },
      }),
    });
    if (!res.status) throw new PaymentProviderError(`Paystack initialize: ${res.message}`);
    return { redirectUrl: res.data.authorization_url };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    const res = await this.call<{ status: string; amount: number; currency: string; channel: string | null; paid_at: string | null; reference: string }>(
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    if (!res.status) return { reference, status: "pending", amountKobo: 0n, currency: "NGN", channel: null, paidAt: null, raw: res };
    const d = res.data;
    const status = d.status === "success" ? "success" : d.status === "failed" ? "failed" : d.status === "abandoned" ? "abandoned" : "pending";
    return { reference: d.reference, status, amountKobo: BigInt(d.amount), currency: d.currency, channel: d.channel, paidAt: d.paid_at ? new Date(d.paid_at) : null, raw: d };
  }

  verifyWebhook(rawBody: string, headers: Headers): boolean {
    const sig = headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", this.secretKey).update(rawBody).digest("hex");
    return sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  parseWebhook(rawBody: string): WebhookEvent {
    const body = JSON.parse(rawBody) as { event?: string; data?: { id?: number | string; reference?: string; transaction_reference?: string; status?: string } };
    const eventType = body.event ?? "unknown";
    const kind = eventType.startsWith("charge.") ? "charge" : eventType.startsWith("refund.") ? "refund" : eventType.startsWith("transfer.") ? "transfer" : "other";
    return {
      // Refund events repeat with each status; the status keeps them apart.
      eventId: `${eventType}:${body.data?.id ?? body.data?.reference ?? "none"}${kind === "refund" ? `:${body.data?.status ?? ""}` : ""}`,
      eventType,
      reference: kind === "refund" ? (body.data?.transaction_reference ?? null) : kind === "charge" ? (body.data?.reference ?? null) : null,
      isChargeSuccess: eventType === "charge.success",
      kind,
      transferReference: kind === "transfer" ? (body.data?.reference ?? null) : null,
      payload: body,
    };
  }

  private refundResult(res: Res<{ id: number; status: string }>): ProviderRefund {
    if (!res.status) return { providerRefundReference: null, status: "failed", message: res.message, raw: res };
    const s = res.data.status;
    return {
      providerRefundReference: String(res.data.id),
      status: s === "processed" ? "completed" : s === "failed" ? "failed" : "processing",
      raw: res.data,
    };
  }

  async refund(p: StartRefund): Promise<ProviderRefund> {
    const res = await this.call<{ id: number; status: string }>("/refund", {
      method: "POST",
      body: JSON.stringify({ transaction: p.paymentReference, amount: p.amountKobo.toString(), currency: "NGN", merchant_note: `TownMart refund ${p.refundNumber}` }),
    });
    return this.refundResult(res);
  }

  async refundStatus(providerRefundReference: string): Promise<ProviderRefund> {
    return this.refundResult(await this.call<{ id: number; status: string }>(`/refund/${encodeURIComponent(providerRefundReference)}`));
  }
}
