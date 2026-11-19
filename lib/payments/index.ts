import { devDriversAllowed, env } from "@/lib/env";
import { FakePaymentProvider } from "./fake";
import { isTestMode } from "@/lib/platform";
import { FlutterwaveProvider, flutterwaveKeyMode } from "./flutterwave";
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
      if (isTestMode() && !e.PAYSTACK_SECRET_KEY.startsWith("sk_test_")) throw new Error("A test site only takes Paystack test keys (sk_test_…).");
      p = new PaystackProvider(e.PAYSTACK_SECRET_KEY);
    } else if (name === "flutterwave") {
      if (!e.FLUTTERWAVE_SECRET_KEY) throw new Error("FLUTTERWAVE_SECRET_KEY is required for Flutterwave payments");
      // A test site has demo admin sign-ins, so it must never take real money.
      if (isTestMode() && flutterwaveKeyMode(e.FLUTTERWAVE_SECRET_KEY) !== "test") {
        throw new Error("A test site only takes Flutterwave test keys (FLWSECK_TEST-…). Live keys belong on the live site.");
      }
      p = new FlutterwaveProvider(e.FLUTTERWAVE_SECRET_KEY, e.FLUTTERWAVE_WEBHOOK_HASH);
    } else {
      if (!devDriversAllowed()) throw new Error("The fake payment provider is for development and test sites only");
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

/**
 * For the test-site health page: which payment provider is on, whether its
 * keys are test keys, whether webhooks can be checked, and whether the
 * provider accepts the key. Never shows the keys themselves.
 */
export async function paymentsStatus(): Promise<{ provider: ProviderName; ok: boolean; keyMode?: string; webhookHashSet?: boolean; error?: string }> {
  const e = env();
  const provider = e.PAYMENT_PROVIDER;
  if (provider === "fake") return { provider, ok: true };
  if (provider === "paystack") return { provider, ok: Boolean(e.PAYSTACK_SECRET_KEY), keyMode: e.PAYSTACK_SECRET_KEY?.startsWith("sk_test_") ? "test" : e.PAYSTACK_SECRET_KEY ? "live" : "missing" };
  const base = { provider, keyMode: e.FLUTTERWAVE_SECRET_KEY ? flutterwaveKeyMode(e.FLUTTERWAVE_SECRET_KEY) : "missing", webhookHashSet: Boolean(e.FLUTTERWAVE_WEBHOOK_HASH) };
  try {
    const fw = paymentProvider("flutterwave") as FlutterwaveProvider;
    const res = await fw.check();
    if (res.ok && !base.webhookHashSet) return { ...base, ok: false, error: "FLUTTERWAVE_WEBHOOK_HASH is not set, so Flutterwave's payment messages are refused" };
    return { ...base, ...res };
  } catch (err) {
    return { ...base, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
