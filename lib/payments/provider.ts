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
  /** Refund and transfer events are also only hints: the refund or payout is checked with the API. */
  kind: "charge" | "refund" | "transfer" | "other";
  /** For transfer events: our payout reference. */
  transferReference?: string | null;
  payload: unknown;
};

export type StartRefund = {
  /** The charge's reference (our payment reference). */
  paymentReference: string;
  amountKobo: bigint;
  /** Our refund number, for the provider's records. */
  refundNumber: string;
  /** The provider's verification response for the charge (Flutterwave refunds by its transaction id). */
  verification: unknown;
};

export type ProviderRefund = {
  providerRefundReference: string | null;
  status: "processing" | "completed" | "failed";
  message?: string;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: ProviderName;
  start(p: StartPayment): Promise<{ redirectUrl: string }>;
  verify(reference: string): Promise<VerifiedPayment>;
  /** Checks the webhook signature over the raw body. Never throws on bad input. */
  verifyWebhook(rawBody: string, headers: Headers): boolean;
  parseWebhook(rawBody: string): WebhookEvent;
  /** Refunds (part of) a successful charge back to the customer's original payment method. */
  refund(p: StartRefund): Promise<ProviderRefund>;
  refundStatus(providerRefundReference: string): Promise<ProviderRefund>;
}

export class PaymentProviderError extends Error {}
