import { z } from "zod";
import { CUSTOMER_REASONS } from "@/lib/refunds/math";
import { customerOrderRef } from "./fulfilment";

const uuid = z.uuid();
const naira = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter an amount in naira, like 2500 or 2500.50");

export const cancelOrderSchema = customerOrderRef.extend({ sellerOrderId: uuid, reason: z.string().trim().max(300).optional().default("") });

export const refundRequestSchema = customerOrderRef.extend({
  sellerOrderId: uuid,
  reason: z.enum(CUSTOMER_REASONS, { error: "Choose what went wrong" }),
  details: z.string().trim().min(10, "Tell the seller what happened (at least 10 characters)").max(2000),
  items: z
    .array(z.object({ orderItemId: uuid, qty: z.number().positive().max(100_000) }))
    .min(1, "Choose at least one item")
    .max(50),
  evidenceKeys: z.array(z.string().max(200)).max(4, "Up to 4 photos").default([]),
});

export const openDisputeSchema = customerOrderRef.extend({
  sellerOrderId: uuid,
  refundId: uuid.optional(),
  reason: z.string().trim().min(10, "Tell TownMart what happened (at least 10 characters)").max(2000),
});

export const customerDisputeMessageSchema = customerOrderRef.extend({ disputeId: uuid, body: z.string().trim().min(1, "Write a message").max(2000) });
export const withdrawDisputeSchema = customerOrderRef.extend({ disputeId: uuid });

export const approveRefundSchema = z.object({
  refundId: uuid,
  /** Naira; empty means the amount asked for. */
  amount: z.union([naira, z.literal("")]).optional().default(""),
  restock: z.array(uuid).max(50).default([]),
  note: z.string().trim().max(500).optional().default(""),
});
export const rejectRefundSchema = z.object({ refundId: uuid, response: z.string().trim().min(10, "Explain to the customer why (at least 10 characters)").max(1000) });
export const disputeMessageSchema = z.object({ disputeId: uuid, body: z.string().trim().min(1, "Write a message").max(2000) });

export const adminRefundSchema = z.object({
  sellerOrderId: uuid,
  amount: z.union([naira, z.literal("")]).default(""),
  reason: z.enum(["not_received", "damaged", "wrong_item", "not_as_described", "changed_mind", "provider_no_show", "cancelled_by_seller", "other"]),
  note: z.string().trim().min(5, "Add a note for the record").max(1000),
  restock: z.array(uuid).max(50).default([]),
});
export const resolveDisputeSchema = z.object({
  disputeId: uuid,
  outcome: z.enum(["refund_full", "refund_partial", "no_refund"]),
  amount: z.union([naira, z.literal("")]).default(""),
  note: z.string().trim().min(10, "Explain the decision to both sides (at least 10 characters)").max(2000),
});
export const refundIdSchema = z.object({ refundId: uuid });
export const statementMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
