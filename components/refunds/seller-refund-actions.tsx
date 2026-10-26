"use client";

import { approveRefundAction, rejectRefundAction } from "@/lib/refunds/seller-actions";
import { RefundDecision } from "./seller-refund-decision";

export function SellerRefundDecision(props: { refundId: string; maxNaira: string; items: { orderItemId: string; title: string; qty: string; product: boolean }[] }) {
  return <RefundDecision {...props} who="seller" approve={approveRefundAction} reject={rejectRefundAction} />;
}
