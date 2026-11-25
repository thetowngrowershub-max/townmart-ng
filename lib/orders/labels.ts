import type { OrderPaymentStatus, OrderStatus, PaymentProviderName } from "@prisma/client";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: "Awaiting payment",
  paid: "Paid",
  processing: "Processing",
  ready_for_pickup: "Ready for pickup",
  shipped: "On its way",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
  refund_requested: "Refund requested",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

export const PAYMENT_STATUS_LABELS: Record<OrderPaymentStatus, string> = {
  unpaid: "Not paid",
  paid: "Paid",
  failed: "Payment failed",
  pay_on_delivery: "Pay on delivery",
  refunded: "Refunded",
  partially_refunded: "Partly refunded",
};

export const PROVIDER_LABELS: Record<PaymentProviderName, string> = {
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  pay_on_delivery: "Pay on delivery",
  fake: "Test payment",
};
