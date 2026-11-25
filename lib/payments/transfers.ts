import { env } from "@/lib/env";
import { koboToNairaString } from "@/lib/money";
import { flutterwaveRecipient } from "./banks";
import { flutterwaveKeyMode } from "./flutterwave";

/**
 * Seller and rider payouts by bank transfer from TownMart's provider balance.
 * The bank account is registered with the provider when it's saved
 * (lib/payments/banks.ts); TownMart sends only the recipient code.
 */
export type TransferResult = { status: "processing" | "paid" | "failed"; transferCode: string | null; message?: string; raw: unknown };

export interface TransferProvider {
  /** The provider-clearing ledger account the money leaves from. */
  readonly name: "paystack" | "flutterwave" | "fake";
  /** True when no real money moves (development, or a test site holding a live key). */
  readonly simulated: boolean;
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
  readonly simulated = false;
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

type FlwRes<T> = { status: string; message: string; data: T };
type FlwTransfer = { id: number; status: string; reference: string; complete_message?: string | null };

function flutterwaveStatus(s: string): TransferResult["status"] {
  const v = s.toUpperCase();
  if (v === "SUCCESSFUL") return "paid";
  if (v === "FAILED") return "failed";
  // NEW and PENDING.
  return "processing";
}

/**
 * Flutterwave v3 transfers (amounts in naira). The bank code and account
 * number come from the sealed recipient code saved with the bank account.
 */
export class FlutterwaveTransfers implements TransferProvider {
  readonly name = "flutterwave" as const;
  readonly simulated = false;
  constructor(private readonly secretKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<{ http: number; body: FlwRes<T> | null }> {
    const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(20_000),
    });
    return { http: res.status, body: (await res.json().catch(() => null)) as FlwRes<T> | null };
  }

  private result(t: FlwTransfer): TransferResult {
    const status = flutterwaveStatus(t.status);
    return { status, transferCode: String(t.id), message: status === "failed" ? (t.complete_message ?? "The bank transfer failed") : undefined, raw: t };
  }

  async send(p: { reference: string; amountKobo: bigint; recipientCode: string; reason: string }): Promise<TransferResult> {
    const to = flutterwaveRecipient.open(p.recipientCode);
    if (!to) return { status: "failed", transferCode: null, message: "Bank account isn't set up for Flutterwave payouts. Save it again.", raw: null };
    const { http, body } = await this.call<FlwTransfer | null>("/transfers", {
      method: "POST",
      body: JSON.stringify({
        account_bank: to.bankCode,
        account_number: to.accountNumber,
        amount: Number(koboToNairaString(p.amountKobo)),
        currency: "NGN",
        debit_currency: "NGN",
        narration: p.reason.slice(0, 80),
        reference: p.reference,
      }),
    });
    if (!body) throw new Error(`Flutterwave transfer: HTTP ${http}`);
    if (body.status === "success" && body.data) return this.result(body.data);
    // A 5xx or a duplicate reference: we can't tell if Flutterwave took it, so look it up before giving up.
    const known = await this.verify(p.reference).catch(() => null);
    if (known) return known;
    if (http >= 500) throw new Error(`Flutterwave transfer: HTTP ${http} ${body.message}`);
    return { status: "failed", transferCode: body.data ? String(body.data.id) : null, message: body.data?.complete_message || body.message, raw: body };
  }

  async verify(reference: string): Promise<TransferResult | null> {
    const { http, body } = await this.call<FlwTransfer[]>(`/transfers?reference=${encodeURIComponent(reference)}`);
    if (!body) throw new Error(`Flutterwave transfer lookup: HTTP ${http}`);
    if (body.status !== "success") {
      if (http === 404) return null;
      throw new Error(`Flutterwave transfer lookup: ${body.message}`);
    }
    const t = (body.data ?? []).find((d) => d.reference === reference);
    return t ? this.result(t) : null;
  }
}

/** Development, tests and test sites (refused on a live site by lib/env): transfers succeed at once. */
export class FakeTransfers implements TransferProvider {
  readonly name = "fake" as const;
  readonly simulated = true;
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

/**
 * Payouts go through the provider bank accounts are registered with
 * (BANK_VERIFIER). A test site never sends real money: with a live
 * Flutterwave key there, transfers are simulated, like BANK_VERIFIER=fake.
 */
export function transferProvider(): TransferProvider {
  if (!provider) {
    const e = env();
    if (e.BANK_VERIFIER === "flutterwave") {
      if (!e.FLUTTERWAVE_SECRET_KEY) throw new Error("FLUTTERWAVE_SECRET_KEY is required for payouts");
      provider = e.TOWNMART_TEST_MODE && flutterwaveKeyMode(e.FLUTTERWAVE_SECRET_KEY) !== "test" ? new FakeTransfers() : new FlutterwaveTransfers(e.FLUTTERWAVE_SECRET_KEY.trim());
    } else if (e.BANK_VERIFIER === "paystack") {
      if (!e.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is required for payouts");
      provider = new PaystackTransfers(e.PAYSTACK_SECRET_KEY);
    } else {
      provider = new FakeTransfers();
    }
  }
  return provider;
}

/**
 * Whether a saved bank account can be paid by the current payout provider:
 * its recipient code must have been registered with that provider. Accounts
 * saved before the provider was recorded keep working as before with
 * Paystack (or fake) payouts, and must be saved again for Flutterwave.
 */
export function recipientUsable(acct: { providerRecipientCode: string | null; recipientProvider: string | null; verifiedAt: Date | null } | null | undefined): boolean {
  if (!acct?.verifiedAt || !acct.providerRecipientCode) return false;
  const current = env().BANK_VERIFIER;
  if (acct.recipientProvider) return acct.recipientProvider === current;
  if (acct.providerRecipientCode.startsWith(flutterwaveRecipient.prefix)) return current === "flutterwave";
  return current !== "flutterwave";
}

/** For tests: forget the cached provider after changing the environment. */
export function resetTransferProvider() {
  provider = undefined;
}
