import { decrypt, encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";

export type Bank = { code: string; name: string };

/**
 * Verifies seller and rider bank accounts and registers them with the
 * provider payouts go through: Paystack (a subaccount for split settlement and
 * a transfer recipient) or Flutterwave (account check only). TownMart shows
 * only the last 4 digits; the full number stays with Paystack, or, for
 * Flutterwave, inside the encrypted recipient code (lib/payments/transfers.ts).
 */
export interface BankVerifier {
  readonly name: "paystack" | "flutterwave" | "fake";
  listBanks(): Promise<Bank[]>;
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string } | null>;
  createSubaccount(params: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
    percentageCharge: number;
  }): Promise<{ subaccountCode: string | null }>;
  createTransferRecipient(params: { accountName: string; bankCode: string; accountNumber: string }): Promise<{ recipientCode: string }>;
}

type PaystackResponse<T> = { status: boolean; message: string; data: T };

class PaystackBankVerifier implements BankVerifier {
  readonly name = "paystack" as const;
  private banksCache: { at: number; banks: Bank[] } | null = null;

  constructor(private readonly secretKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<PaystackResponse<T>> {
    const res = await fetch(`https://api.paystack.co${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", ...init?.headers },
    });
    const body = (await res.json().catch(() => null)) as PaystackResponse<T> | null;
    if (!body) throw new Error(`Paystack ${path}: HTTP ${res.status}`);
    return body;
  }

  async listBanks(): Promise<Bank[]> {
    if (this.banksCache && Date.now() - this.banksCache.at < 24 * 3600_000) return this.banksCache.banks;
    const res = await this.call<{ code: string; name: string; active: boolean }[]>("/bank?country=nigeria&perPage=200");
    if (!res.status) throw new Error(`Paystack banks: ${res.message}`);
    const banks = res.data.filter((b) => b.active).map((b) => ({ code: b.code, name: b.name }));
    this.banksCache = { at: Date.now(), banks };
    return banks;
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const res = await this.call<{ account_name: string }>(
      `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
    );
    return res.status ? { accountName: res.data.account_name } : null;
  }

  async createSubaccount(params: { businessName: string; bankCode: string; accountNumber: string; percentageCharge: number }) {
    const res = await this.call<{ subaccount_code: string }>("/subaccount", {
      method: "POST",
      body: JSON.stringify({
        business_name: params.businessName,
        settlement_bank: params.bankCode,
        account_number: params.accountNumber,
        percentage_charge: params.percentageCharge,
      }),
    });
    if (!res.status) throw new Error(`Paystack subaccount: ${res.message}`);
    return { subaccountCode: res.data.subaccount_code };
  }

  async createTransferRecipient(params: { accountName: string; bankCode: string; accountNumber: string }) {
    const res = await this.call<{ recipient_code: string }>("/transferrecipient", {
      method: "POST",
      body: JSON.stringify({ type: "nuban", name: params.accountName, account_number: params.accountNumber, bank_code: params.bankCode, currency: "NGN" }),
    });
    if (!res.status) throw new Error(`Paystack transfer recipient: ${res.message}`);
    return { recipientCode: res.data.recipient_code };
  }
}

/** Development only (refused in production): any 10-digit account resolves to a test name. */
export const FAKE_BANKS: Bank[] = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "Guaranty Trust Bank" },
  { code: "011", name: "First Bank of Nigeria" },
  { code: "033", name: "United Bank For Africa" },
  { code: "057", name: "Zenith Bank" },
  { code: "50211", name: "Kuda Bank" },
  { code: "999992", name: "OPay Digital Services Limited (OPay)" },
  { code: "50515", name: "Moniepoint MFB" },
];

class FakeBankVerifier implements BankVerifier {
  readonly name = "fake" as const;
  async listBanks() {
    return FAKE_BANKS;
  }
  async resolveAccount(bankCode: string, accountNumber: string) {
    if (!FAKE_BANKS.some((b) => b.code === bankCode) || !/^\d{10}$/.test(accountNumber)) return null;
    return { accountName: `TEST ACCOUNT ${accountNumber.slice(-4)}` };
  }
  async createSubaccount(params: { accountNumber: string }) {
    return { subaccountCode: `ACCT_test_${params.accountNumber.slice(-4)}` };
  }
  async createTransferRecipient(params: { accountNumber: string }) {
    return { recipientCode: `RCP_test_${params.accountNumber.slice(-4)}` };
  }
}

type FlwRes<T> = { status: string; message: string; data: T };

/**
 * Flutterwave v3: banks and account name checks. Flutterwave transfers take
 * the bank code and account number on each transfer, so the "recipient code"
 * TownMart keeps is those two, encrypted with DATA_ENCRYPTION_KEY.
 */
class FlutterwaveBankVerifier implements BankVerifier {
  readonly name = "flutterwave" as const;
  private banksCache: { at: number; banks: Bank[] } | null = null;

  constructor(private readonly secretKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<FlwRes<T>> {
    const res = await fetch(`https://api.flutterwave.com/v3${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as FlwRes<T> | null;
    if (!body) throw new Error(`Flutterwave ${path}: HTTP ${res.status}`);
    return body;
  }

  async listBanks(): Promise<Bank[]> {
    if (this.banksCache && Date.now() - this.banksCache.at < 24 * 3600_000) return this.banksCache.banks;
    const res = await this.call<{ code: string; name: string }[]>("/banks/NG");
    if (res.status !== "success") throw new Error(`Flutterwave banks: ${res.message}`);
    const seen = new Set<string>();
    const banks = res.data
      .filter((b) => b.code && !seen.has(b.code) && seen.add(b.code))
      .map((b) => ({ code: b.code, name: b.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    this.banksCache = { at: Date.now(), banks };
    return banks;
  }

  async resolveAccount(bankCode: string, accountNumber: string) {
    const res = await this.call<{ account_name: string } | null>("/accounts/resolve", {
      method: "POST",
      body: JSON.stringify({ account_number: accountNumber, account_bank: bankCode }),
    });
    return res.status === "success" && res.data?.account_name ? { accountName: res.data.account_name } : null;
  }

  async createSubaccount() {
    // Payments settle to TownMart and sellers are paid by transfer, so no split subaccount.
    return { subaccountCode: null };
  }

  async createTransferRecipient(params: { bankCode: string; accountNumber: string }) {
    return { recipientCode: flutterwaveRecipient.seal(params.bankCode, params.accountNumber) };
  }
}

/** The bank code and account number a Flutterwave payout goes to, sealed for storage. */
export const flutterwaveRecipient = {
  prefix: "flw:",
  seal(bankCode: string, accountNumber: string) {
    return `${this.prefix}${encrypt(JSON.stringify({ b: bankCode, n: accountNumber }))}`;
  },
  open(code: string): { bankCode: string; accountNumber: string } | null {
    if (!code.startsWith(this.prefix)) return null;
    try {
      const v = JSON.parse(decrypt(code.slice(this.prefix.length))) as { b?: unknown; n?: unknown };
      return typeof v.b === "string" && typeof v.n === "string" ? { bankCode: v.b, accountNumber: v.n } : null;
    } catch {
      return null;
    }
  },
};

let verifier: BankVerifier | undefined;

export function bankVerifier(): BankVerifier {
  if (!verifier) {
    const e = env();
    if (e.BANK_VERIFIER === "paystack") {
      if (!e.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is required when BANK_VERIFIER=paystack");
      verifier = new PaystackBankVerifier(e.PAYSTACK_SECRET_KEY);
    } else if (e.BANK_VERIFIER === "flutterwave") {
      if (!e.FLUTTERWAVE_SECRET_KEY) throw new Error("FLUTTERWAVE_SECRET_KEY is required when BANK_VERIFIER=flutterwave");
      verifier = new FlutterwaveBankVerifier(e.FLUTTERWAVE_SECRET_KEY.trim());
    } else {
      verifier = new FakeBankVerifier();
    }
  }
  return verifier;
}
