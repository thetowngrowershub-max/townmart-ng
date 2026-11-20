import { env } from "@/lib/env";
import { isTestMode } from "@/lib/platform";
import { flutterwaveKeyMode } from "./flutterwave";

/**
 * Live-gateway testing on the test site. When a test-mode site has a live
 * Flutterwave key, real orders can't be paid for online. Only payment testers
 * (LIVE_PAYMENT_TESTERS: verified account emails) can pay, and each payment is
 * a small fixed charge (LIVE_TEST_CHARGE_NAIRA, default NGN 100) that is
 * refunded automatically and never marks the order paid. That exercises the
 * whole gateway (payment page, webhook, verify, refund) with no real sale.
 */
export function liveGatewayTest(): boolean {
  const e = env();
  // Anything that isn't plainly a test key is treated as live, so an unexpected key format can't take real money.
  return isTestMode() && e.PAYMENT_PROVIDER === "flutterwave" && flutterwaveKeyMode(e.FLUTTERWAVE_SECRET_KEY) !== "test";
}

/** Gateway-test payments carry this suffix on their reference, so they can never be applied to an order. */
export const GATEWAY_TEST_SUFFIX = "-GWTEST";
export const isGatewayTestReference = (reference: string) => reference.endsWith(GATEWAY_TEST_SUFFIX);

export const gatewayTestChargeKobo = () => BigInt(env().LIVE_TEST_CHARGE_NAIRA) * 100n;

/** A payment tester: a signed-in account whose email is verified and on the list. */
export function isPaymentTester(user: { email: string; emailVerified: Date | null } | null): boolean {
  if (!user?.emailVerified) return false;
  const list = (env().LIVE_PAYMENT_TESTERS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(user.email.toLowerCase());
}
