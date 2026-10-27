"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { findCartOwner } from "@/lib/cart";
import { withRls, withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { findViewableOrder } from "@/lib/orders/access";
import { orderAccessToken, OrderError, placeOrder } from "@/lib/orders/place";
import { PaymentError, startOnlinePayment, verifyAndApply } from "@/lib/orders/payment";
import { FakePaymentProvider } from "@/lib/payments/fake";
import { enqueueOrderEvent } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { checkoutSchema, quoteRequestSchema, type CheckoutInput } from "@/lib/validation/checkout";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { env } from "@/lib/env";
import { computeCheckout } from "./compute";
import { toCheckoutView, type CheckoutView } from "./view";

const TOO_MANY = "Too many attempts. Please wait a minute and try again.";

/** Re-prices checkout for an address and delivery choices (the page calls this as the shopper fills it in). */
export async function quoteCheckoutAction(input: { addressId?: string; stateId?: number; lgaId?: number; methods?: Record<string, "delivery" | "pickup"> }): Promise<ActionResult<CheckoutView>> {
  const parsed = quoteRequestSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const owner = await findCartOwner();
  let address: { stateId: number; lgaId: number } | null = null;
  if (parsed.data.addressId && owner.userId) {
    const a = await withRls({ userId: owner.userId }, (tx) => tx.address.findFirst({ where: { id: parsed.data.addressId!, userId: owner.userId! }, select: { stateId: true, lgaId: true } }));
    address = a;
  } else if (parsed.data.stateId && parsed.data.lgaId) {
    address = { stateId: parsed.data.stateId, lgaId: parsed.data.lgaId };
  }
  const c = await withSystemContext((tx) => computeCheckout(tx, { cartId: owner.cartId, userId: owner.userId, address, methods: parsed.data.methods }));
  return { ok: true, data: toCheckoutView(c) };
}

export async function placeOrderAction(input: CheckoutInput): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const meta = await requestMeta();
  if (!(await rateLimit(`checkout:${meta.ipHash}`, 10, 600)).allowed) return { ok: false, error: TOO_MANY };

  const user = await getCurrentUser();
  const owner = await findCartOwner();
  if (!owner.cartId) return { ok: false, error: "Your cart is empty." };

  let placed;
  try {
    placed = await withSystemContext(
      (tx) =>
        placeOrder(tx, {
          cartId: owner.cartId!,
          userId: user?.id ?? null,
          accountEmail: user?.email ?? null,
          accountName: user?.name ?? null,
          data: parsed.data,
          ipHash: meta.ipHash,
          userAgent: meta.userAgent,
        }),
      { timeout: 30_000 },
    );
  } catch (err) {
    if (err instanceof OrderError) return { ok: false, error: err.message, fieldErrors: err.code === "price_changed" ? { expectedTotalKobo: [err.message] } : undefined };
    logger.error({ err }, "place order failed");
    return { ok: false, error: "We couldn't place your order. Nothing was charged. Please try again." };
  }

  const done = `/checkout/complete/${placed.orderNumber}?t=${encodeURIComponent(placed.accessToken)}`;
  if (placed.payment === "pay_on_delivery") {
    await enqueueOrderEvent({ kind: "order.confirmed", orderId: placed.orderId });
    return { ok: true, data: { redirectTo: done } };
  }
  try {
    const { redirectUrl } = await startOnlinePayment(placed.orderId, placed.accessToken);
    return { ok: true, data: { redirectTo: redirectUrl } };
  } catch (err) {
    // The order exists with its stock held; the shopper can retry from the order page.
    logger.error({ err, orderNumber: placed.orderNumber }, "starting payment failed");
    return { ok: true, data: { redirectTo: `${done}&payment=failed` } };
  }
}

export async function retryPaymentAction(input: { orderNumber: string; token: string | null }): Promise<ActionResult<{ redirectTo: string }>> {
  const meta = await requestMeta();
  if (!(await rateLimit(`pay-retry:${meta.ipHash}`, 10, 600)).allowed) return { ok: false, error: TOO_MANY };
  const order = await findViewableOrder(input.orderNumber, input.token);
  if (!order) return { ok: false, error: "Order not found." };
  try {
    const { redirectUrl } = await startOnlinePayment(order.id, orderAccessToken(order.id));
    return { ok: true, data: { redirectTo: redirectUrl } };
  } catch (err) {
    if (err instanceof PaymentError) return { ok: false, error: err.message };
    logger.error({ err }, "retry payment failed");
    return { ok: false, error: "We couldn't start the payment. Please try again." };
  }
}

/** The shopper is back from the payment page: check with the provider now rather than waiting for the webhook. */
export async function checkPaymentAction(input: { orderNumber: string; token: string | null }): Promise<ActionResult<{ status: string }>> {
  const order = await findViewableOrder(input.orderNumber, input.token);
  if (!order) return { ok: false, error: "Order not found." };
  const latest = await withSystemContext((tx) => tx.payment.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" }, select: { providerReference: true, status: true } }));
  if (!latest) return { ok: true, data: { status: "none" } };
  if (latest.status !== "initiated") return { ok: true, data: { status: latest.status } };
  try {
    return { ok: true, data: { status: await verifyAndApply(latest.providerReference) } };
  } catch (err) {
    logger.warn({ err }, "payment check failed");
    return { ok: true, data: { status: "pending" } };
  }
}

/** Development only: the stand-in payment page's Pay / Decline buttons. */
export async function settleFakePaymentAction(input: { reference: string; outcome: "success" | "failed" }): Promise<ActionResult<{ redirectTo: string }>> {
  if (env().NODE_ENV === "production" || env().PAYMENT_PROVIDER !== "fake") return { ok: false, error: "Not available." };
  const callback = await FakePaymentProvider.settle(input.reference, input.outcome === "success" ? "success" : "failed");
  if (!callback) return { ok: false, error: "This test payment has expired." };
  return { ok: true, data: { redirectTo: callback } };
}
