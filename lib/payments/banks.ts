import { env } from "@/lib/env";

export type Bank = { code: string; name: string };

/**
 * Verifies seller bank accounts and registers them with Paystack: a
 * subaccount (for split settlement) and a transfer recipient (for payouts,
 * lib/payments/transfers.ts). TownMart keeps only the last 4 digits.
 */
export interface BankVerifier {
  readonly name: string;
  listBanks(): Promise<Bank[]>;
  resolveAccount(bankCode: string, accountNumber: string): Promise<{ accountName: string } | null>;
  createSubaccount(params: {
    businessName: string;
    bankCode: string;
    accountNumber: string;
    percentageCharge: number;
  }): Promise<{ subaccountCode: string }>;
  createTransferRecipient(params: { accountName: string; bankCode: string; accountNumber: string }): Promise<{ recipientCode: string }>;
}

type PaystackResponse<T> = { status: boolean; message: string; data: T };

class PaystackBankVerifier implements BankVerifier {
  readonly name = "paystack";
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
  readonly name = "fake";
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

let verifier: BankVerifier | undefined;

export function bankVerifier(): BankVerifier {
  if (!verifier) {
    const e = env();
    if (e.BANK_VERIFIER === "paystack") {
      if (!e.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is required when BANK_VERIFIER=paystack");
      verifier = new PaystackBankVerifier(e.PAYSTACK_SECRET_KEY);
    } else {
      verifier = new FakeBankVerifier();
    }
  }
  return verifier;
}
