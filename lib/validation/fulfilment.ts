import { z } from "zod";

const uuid = z.uuid();

export const advanceOrderSchema = z.object({
  id: uuid,
  to: z.enum(["processing", "shipped", "ready_for_pickup", "delivered"]),
  trackingNumber: z.string().trim().max(60).optional().default(""),
  carrier: z.string().trim().max(60).optional().default(""),
});

export const sellerOrderIdSchema = z.object({ id: uuid });

export const cancelReasonSchema = z.object({
  id: uuid,
  reason: z.string().trim().min(3, "Tell the customer why, in a few words").max(300),
});

export const messageSchema = z.object({
  sellerOrderId: uuid,
  body: z.string().trim().min(1, "Write a message").max(2000, "Keep it under 2,000 characters"),
});

/** A customer acting on their order: signed in, or with the guest link's token. */
export const customerOrderRef = z.object({
  orderNumber: z.string().regex(/^TM-\d{4}-\d{6,}$/),
  token: z.string().max(100).nullable().optional(),
});

export const customerMessageSchema = customerOrderRef.extend(messageSchema.shape);
export const confirmReceivedSchema = customerOrderRef.extend({ sellerOrderId: uuid });

export const bookingStepSchema = z.object({ bookingId: uuid, step: z.enum(["confirm", "start", "complete", "no_show"]) });
export const sellerCancelBookingSchema = z.object({ bookingId: uuid, reason: z.string().trim().min(3, "Tell the customer why, in a few words").max(300) });
export const sellerRescheduleSchema = z.object({ bookingId: uuid, startsAt: z.iso.datetime({ offset: true, error: "Choose a time" }) });
export const customerCancelBookingSchema = customerOrderRef.extend({ bookingId: uuid, reason: z.string().trim().max(300).optional().default("") });
export const customerRescheduleSchema = customerOrderRef.extend({ bookingId: uuid, startsAt: z.iso.datetime({ offset: true, error: "Choose a time" }) });
