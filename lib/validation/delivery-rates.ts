import { z } from "zod";
import { nairaAmount, optionalNairaAmount } from "./common";

const kg = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,3})?$/, "Enter a weight in kg, e.g. 5 or 2.5")
  .transform((v) => Math.round(Number(v) * 1000));

const band = z
  .object({
    upToKg: z.union([kg, z.literal("").transform(() => null)]),
    fee: nairaAmount,
    freeOver: optionalNairaAmount,
    etaMin: z.coerce.number().int().min(0, "Days can't be negative").max(30, "Keep it within 30 days"),
    etaMax: z.coerce.number().int().min(0, "Days can't be negative").max(30, "Keep it within 30 days"),
  })
  .refine((b) => b.etaMax >= b.etaMin, { message: "The latest day must be on or after the earliest", path: ["etaMax"] })
  .refine((b) => b.freeOver === null || b.freeOver > 0n, { message: "Leave empty for no free delivery", path: ["freeOver"] });

/**
 * A seller's weight bands for one zone. Bands are listed lightest first; each
 * starts where the one before stops, and only the last may have no limit.
 */
export const zoneRatesSchema = z
  .object({ zoneId: z.uuid(), bands: z.array(band).min(1, "Add at least one weight band").max(8, "Up to 8 bands") })
  .superRefine((v, ctx) => {
    let prev = 0;
    v.bands.forEach((b, i) => {
      const last = i === v.bands.length - 1;
      if (b.upToKg === null && !last) ctx.addIssue({ code: "custom", message: "Only the last band can have no upper limit", path: ["bands", i, "upToKg"] });
      if (b.upToKg !== null && b.upToKg <= prev) ctx.addIssue({ code: "custom", message: "Each band must go higher than the one before", path: ["bands", i, "upToKg"] });
      if (b.upToKg !== null) prev = b.upToKg;
    });
  });
export type ZoneRatesInput = z.input<typeof zoneRatesSchema>;
