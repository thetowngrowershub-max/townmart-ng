"use client";

import { sellerDisputeMessageAction } from "@/lib/refunds/seller-actions";
import type { DisputeView } from "@/lib/refunds/view";
import { DisputeThread } from "./dispute-thread";

export function SellerDispute({ dispute }: { dispute: DisputeView }) {
  return <DisputeThread dispute={dispute} me="seller" send={(body) => sellerDisputeMessageAction({ disputeId: dispute.id, body })} />;
}
