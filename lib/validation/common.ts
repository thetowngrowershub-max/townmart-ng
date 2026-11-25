import { z } from "zod";
import { lagosLocalToDate } from "@/lib/datetime";
import { parseNairaToKobo } from "@/lib/money";
import { normaliseNigerianPhone } from "@/lib/phone";

export const uuid = z.uuid({ error: "Choose an option" });

/** Naira typed by a person ("2500", "2,500.50") → kobo BigInt. */
export const nairaAmount = z
  .string()
  .trim()
  .regex(/^₦?\s?\d{1,3}(,?\d{3})*(\.\d{1,2})?$/, "Enter an amount in naira, e.g. 2500 or 2,500.50")
  .transform((v) => parseNairaToKobo(v));

export const optionalNairaAmount = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    try {
      return parseNairaToKobo(v);
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter an amount in naira, e.g. 2500" });
      return z.NEVER;
    }
  });

/** Quantity with up to 3 decimals, as a string so it maps exactly onto numeric(12,3). */
export const quantity = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,3})?$/, "Enter a number, e.g. 10 or 2.5");

export const signedQuantity = z
  .string()
  .trim()
  .regex(/^-?\d{1,9}(\.\d{1,3})?$/, "Enter a number, e.g. 10, -3 or 2.5")
  .refine((v) => Number(v) !== 0, "Enter a non-zero amount");

export const commaList = (max: number, itemMax = 40) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().max(itemMax)).max(max, `At most ${max} items`));

export const nigerianPhone = z
  .string()
  .trim()
  .refine((v) => normaliseNigerianPhone(v) !== null, "Enter a Nigerian mobile number, e.g. 0803 123 4567")
  .transform((v) => normaliseNigerianPhone(v)!);

export const otpCode = z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code");

/** A `datetime-local` value, read as Lagos time. */
export const lagosDateTime = (message: string) =>
  z
    .string({ error: message })
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, message)
    .transform(lagosLocalToDate);
