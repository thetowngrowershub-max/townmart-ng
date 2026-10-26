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
