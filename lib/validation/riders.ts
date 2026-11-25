import { z } from "zod";
import { RIDER_VEHICLES } from "@/lib/fulfilment/rider-vehicles";
import { nigerianPhone } from "./common";
import { gpsSchema } from "./checkout";

export const riderSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2, "Enter the rider's name").max(80),
  phone: nigerianPhone,
  vehicle: z.enum(RIDER_VEHICLES),
  isAvailable: z.boolean().default(true),
});
export type RiderInput = z.input<typeof riderSchema>;

export const riderAvailabilitySchema = z.object({ id: z.uuid(), isAvailable: z.boolean() });
export const riderIdSchema = z.object({ id: z.uuid() });
export const assignRiderSchema = z.object({ sellerOrderId: z.uuid(), riderId: z.uuid().nullable() });
export const shopLocationSchema = gpsSchema;
