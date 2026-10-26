import { env } from "@/lib/env";

/**
 * Seller payouts by bank transfer from TownMart's provider balance. The bank
 * account is registered with the provider when the seller saves it
 * (lib/payments/banks.ts); TownMart sends only the recipient code.
 */
export type TransferResult = { status: "processing" | "paid" | "failed"; transferCode: string | null; message?: string; raw: unknown };

export interface TransferProvider {
  /** The provider-clearing ledger account the money leaves from. */
  readonly name: "paystack" | "fake";
  /** `reference` is ours and unique per payout: the provider refuses a second transfer with it. */
  send(p: { reference: string; amountKobo: bigint; recipientCode: string; reason: string }): Promise<TransferResult>;
  /** Looks a transfer up by our reference; null if the provider never received it. */
  verify(reference: string): Promise<TransferResult | null>;
}

type Res<T> = { status: boolean; message: string; data: T };

function paystackStatus(s: string): TransferResult["status"] {
  if (s === "success") return "paid";
  if (s === "failed" || s === "reversed" || s === "abandoned" || s === "rejected") return "failed";
  return "processing";
}

class PaystackTransfers implements TransferProvider {
  readonly name = "paystack" as const;
  constructor(private readonly secretKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<{ http: number; body: Res<T> | null }> {
    const res = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
    return { http: res.status, body: (await res.json().catch(() => null)) as Res<T> | null };
  }

  async send(p: { reference: string; amountKobo: bigint; recipientCode: string; reason: string }): Promise<TransferResult> {
    const { http, body } = await this.call<{ transfer_code: string; status: string }>("/transfer", {
      method: "POST",
      body: JSON.stringify({ source: "balance", amount: p.amountKobo.toString(), recipient: p.recipientCode, reference: p.reference, reason: p.reason, currency: "NGN" }),
    });
    if (!body) throw new Error(`Paystack transfer: HTTP ${http}`);
    if (!body.status) return { status: "failed", transferCode: null, message: body.message, raw: body };
    // "otp" means the account still needs OTP approval for transfers: an ops problem, not a failed payout.
    return { status: paystackStatus(body.data.status), transferCode: body.data.transfer_code, raw: body.data };
  }

  async verify(reference: string): Promise<TransferResult | null> {
    const { http, body } = await this.call<{ transfer_code: string; status: string }>(`/transfer/verify/${encodeURIComponent(reference)}`);
    if (http === 404 || (body && !body.status)) return null;
    if (!body) throw new Error(`Paystack transfer verify: HTTP ${http}`);
    return { status: paystackStatus(body.data.status), transferCode: body.data.transfer_code, raw: body.data };
  }
}

/** Development and tests (refused in production by lib/env): transfers succeed at once. */
export class FakeTransfers implements TransferProvider {
  readonly name = "fake" as const;
  /** Tests set this to make the next transfer fail. */
  static failNext = false;
  private static sent = new Map<string, TransferResult>();

  async send(p: { reference: string; amountKobo: bigint }): Promise<TransferResult> {
    const existing = FakeTransfers.sent.get(p.reference);
    if (existing) return existing;
    const result: TransferResult = FakeTransfers.failNext
      ? { status: "failed", transferCode: null, message: "Transfer declined (test)", raw: null }
      : { status: "paid", transferCode: `TRF_test_${p.reference.slice(-8)}`, raw: { amount: p.amountKobo.toString() } };
    FakeTransfers.failNext = false;
    FakeTransfers.sent.set(p.reference, result);
    return result;
  }

  async verify(reference: string): Promise<TransferResult | null> {
    return FakeTransfers.sent.get(reference) ?? null;
  }
}

let provider: TransferProvider | undefined;

/** Payouts go through the provider seller bank accounts are registered with (BANK_VERIFIER). */
export function transferProvider(): TransferProvider {
  if (!provider) {
    const e = env();
    if (e.BANK_VERIFIER === "paystack") {
      if (!e.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is required for payouts");
      provider = new PaystackTransfers(e.PAYSTACK_SECRET_KEY);
    } else {
      provider = new FakeTransfers();
    }
  }
  return provider;
}
