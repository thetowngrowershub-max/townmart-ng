import { env } from "@/lib/env";
import { FakePaymentProvider } from "./fake";
import { FlutterwaveProvider } from "./flutterwave";
import { PaystackProvider } from "./paystack";
import type { PaymentProvider, ProviderName } from "./provider";

export * from "./provider";

const cache = new Map<ProviderName, PaymentProvider>();

export function paymentProvider(name: ProviderName): PaymentProvider {
  let p = cache.get(name);
  if (!p) {
    const e = env();
    if (name === "paystack") {
      if (!e.PAYSTACK_SECRET_KEY) throw new Error("PAYSTACK_SECRET_KEY is required for Paystack payments");
      p = new PaystackProvider(e.PAYSTACK_SECRET_KEY);
    } else if (name === "flutterwave") {
      if (!e.FLUTTERWAVE_SECRET_KEY) throw new Error("FLUTTERWAVE_SECRET_KEY is required for Flutterwave payments");
      p = new FlutterwaveProvider(e.FLUTTERWAVE_SECRET_KEY, e.FLUTTERWAVE_WEBHOOK_HASH);
    } else {
      if (e.NODE_ENV === "production") throw new Error("The fake payment provider is for development only");
      p = new FakePaymentProvider();
    }
    cache.set(name, p);
  }
  return p;
}

/** The primary provider, then the fallback if one is configured. */
export function paymentProviderOrder(): ProviderName[] {
  const e = env();
  const order: ProviderName[] = [e.PAYMENT_PROVIDER];
  if (e.PAYMENT_FALLBACK_PROVIDER !== "none" && e.PAYMENT_FALLBACK_PROVIDER !== e.PAYMENT_PROVIDER) order.push(e.PAYMENT_FALLBACK_PROVIDER);
  return order;
}
