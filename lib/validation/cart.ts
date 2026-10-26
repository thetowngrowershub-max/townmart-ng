import { z } from "zod";

const uuid = z.uuid();
/** Up to 3 decimal places (kg, litres), at most 9,999. */
export const cartQty = z
  .string()
  .trim()
  .regex(/^\d{1,4}(\.\d{1,3})?$/, "Enter a quantity like 2 or 1.5")
  .refine((v) => Number(v) > 0, "Quantity must be more than 0");

export const addToCartSchema = z.object({ variantId: uuid, qty: cartQty });
export const updateCartItemSchema = z.object({ itemId: uuid, qty: cartQty });
export const cartItemIdSchema = z.object({ itemId: uuid });
export const couponCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,24}$/, "Codes are 4 to 24 letters, numbers or dashes"),
});

/** A booking to add to the cart: a service, an optional package and a start time (an ISO instant from the slot list). */
export const addBookingSchema = z.object({
  serviceId: uuid,
  packageId: uuid.nullable().optional(),
  startsAt: z.iso.datetime({ offset: true, error: "Choose a time" }),
  atProvider: z.boolean().default(false),
});

/** A week of open times, from a Lagos calendar date. */
export const slotsQuerySchema = z.object({
  serviceId: uuid,
  packageId: uuid.nullable().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
