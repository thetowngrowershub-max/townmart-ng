/**
 * Online payments behind one interface, so Paystack and Flutterwave are
 * interchangeable. TownMart never sees card details: shoppers pay on the
 * provider's page and we confirm by calling the provider's verify API.
 */

export type ProviderName = "paystack" | "flutterwave" | "fake";

export type StartPayment = {
  reference: string;
  amountKobo: bigint;
  email: string;
  phone?: string;
  name?: string;
  callbackUrl: string;
  /** Shown on the provider's receipt; no personal data. */
  description: string;
};

export type VerifiedPayment = {
  reference: string;
  status: "success" | "failed" | "abandoned" | "pending";
  amountKobo: bigint;
  currency: string;
  channel: string | null;
  paidAt: Date | null;
  raw: unknown;
};

export type WebhookEvent = {
  /** Unique per provider; repeats of the same delivery share it. */
  eventId: string;
  eventType: string;
  reference: string | null;
  /** True when the event says a charge succeeded (still verified with the API before use). */
  isChargeSuccess: boolean;
  payload: unknown;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  start(p: StartPayment): Promise<{ redirectUrl: string }>;
  verify(reference: string): Promise<VerifiedPayment>;
  /** Checks the webhook signature over the raw body. Never throws on bad input. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
}

export class PaymentProviderError extends Error {}
