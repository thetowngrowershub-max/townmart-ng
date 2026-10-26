import { timingSafeEqual } from "node:crypto";
import { koboToNairaString } from "@/lib/money";
import { PaymentProviderError, type PaymentProvider, type ProviderRefund, type StartPayment, type StartRefund, type VerifiedPayment, type WebhookEvent } from "./provider";

type Res<T> = { status: string; message: string; data: T };

/** Flutterwave works in naira with decimals; we convert at the edge and keep kobo inside. */
const nairaToKobo = (amount: number) => BigInt(Math.round(amount * 100));

export class FlutterwaveProvider implements PaymentProvider {
  readonly name = "flutterwave" as const;
  constructor(
    private readonly secretKey: string,
    private readonly webhookHash: string | undefined,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<Res<T>> {
    const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as Res<T> | null;
    if (!body) throw new PaymentProviderError(`Flutterwave ${path}: HTTP ${res.status}`);
    return body;
  }

  async start(p: StartPayment) {
    const res = await this.call<{ link: string }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: p.reference,
        amount: koboToNairaString(p.amountKobo),
        currency: "NGN",
        redirect_url: p.callbackUrl,
        customer: { email: p.email, phonenumber: p.phone, name: p.name },
        customizations: { title: "TownMart", description: p.description },
      }),
    });
    if (res.status !== "success") throw new PaymentProviderError(`Flutterwave payments: ${res.message}`);
    return { redirectUrl: res.data.link };
  }

  async verify(reference: string): Promise<VerifiedPayment> {
    const res = await this.call<{ status: string; amount: number; currency: string; payment_type: string | null; created_at: string; tx_ref: string }>(
      `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`,
    );
    if (res.status !== "success" || !res.data) return { reference, status: "pending", amountKobo: 0n, currency: "NGN", channel: null, paidAt: null, raw: res };
    const d = res.data;
    const status = d.status === "successful" ? "success" : d.status === "failed" ? "failed" : "pending";
    return { reference: d.tx_ref, status, amountKobo: nairaToKobo(d.amount), currency: d.currency, channel: d.payment_type, paidAt: status === "success" ? new Date(d.created_at) : null, raw: d };
  }

  verifyWebhook(_rawBody: string, headers: Headers): boolean {
    const got = headers.get("verif-hash") ?? "";
    const want = this.webhookHash ?? "";
    return want.length > 0 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  }

  parseWebhook(rawBody: string): WebhookEvent {
    const body = JSON.parse(rawBody) as { event?: string; data?: { id?: number; tx_ref?: string; status?: string; reference?: string } };
    const eventType = body.event ?? "unknown";
    const kind = eventType.startsWith("charge.") ? "charge" : eventType.startsWith("refund.") ? "refund" : eventType.startsWith("transfer.") ? "transfer" : "other";
    return {
      eventId: `${eventType}:${body.data?.id ?? body.data?.tx_ref ?? "none"}${kind === "charge" ? "" : `:${body.data?.status ?? ""}`}`,
      eventType,
      reference: body.data?.tx_ref ?? null,
      isChargeSuccess: eventType === "charge.completed" && body.data?.status === "successful",
      kind,
      transferReference: kind === "transfer" ? (body.data?.reference ?? null) : null,
      payload: body,
    };
  }

  private refundResult(res: Res<{ id: number; status: string } | null>): ProviderRefund {
    if (res.status !== "success" || !res.data) return { providerRefundReference: null, status: "failed", message: res.message, raw: res };
    const s = res.data.status;
    return { providerRefundReference: String(res.data.id), status: s === "completed" ? "completed" : s === "failed" ? "failed" : "processing", raw: res.data };
  }

  async refund(p: StartRefund): Promise<ProviderRefund> {
    // Flutterwave refunds by its own transaction id, which the verify response carries.
    const id = (p.verification as { id?: number } | null)?.id;
    if (!id) return { providerRefundReference: null, status: "failed", message: "No Flutterwave transaction id on this payment", raw: null };
    const res = await this.call<{ id: number; status: string }>(`/transactions/${id}/refund`, {
      method: "POST",
      body: JSON.stringify({ amount: koboToNairaString(p.amountKobo), comments: `TownMart refund ${p.refundNumber}` }),
    });
    return this.refundResult(res);
  }

  async refundStatus(providerRefundReference: string): Promise<ProviderRefund> {
    return this.refundResult(await this.call<{ id: number; status: string }>(`/refunds/${encodeURIComponent(providerRefundReference)}`));
  }
}
