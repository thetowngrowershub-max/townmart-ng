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

/** A TownMart pool rider's application. */
export const poolApplicationSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name").max(80),
    phone: nigerianPhone,
    vehicle: z.enum(RIDER_VEHICLES),
    plateNumber: z
      .string()
      .trim()
      .max(20)
      .transform((v) => v.toUpperCase().replace(/\s+/g, " ")),
    homeTown: z.string().trim().min(2, "Choose where you're based").max(80),
    nin: z
      .string()
      .trim()
      .transform((v) => v.replace(/\D/g, ""))
      .refine((v) => v === "" || v.length === 11, "Your NIN has 11 digits"),
    guarantorName: z.string().trim().min(2, "Enter your guarantor's name").max(80),
    guarantorPhone: nigerianPhone,
    agree: z.literal(true, { error: "Please agree to the rider terms" }),
  })
  .superRefine((d, ctx) => {
    if ((d.vehicle === "motorbike" || d.vehicle === "tricycle" || d.vehicle === "car") && d.plateNumber.length < 4) {
      ctx.addIssue({ code: "custom", path: ["plateNumber"], message: "Enter your plate number" });
    }
    if (d.guarantorPhone === d.phone) ctx.addIssue({ code: "custom", path: ["guarantorPhone"], message: "Your guarantor needs their own phone number" });
  });
export type PoolApplicationInput = z.input<typeof poolApplicationSchema>;

export const onlineSchema = z.object({ online: z.boolean() });
export const sellerOrderRefSchema = z.object({ sellerOrderId: z.uuid() });
export const riderReviewSchema = z.object({
  id: z.uuid(),
  decision: z.enum(["approve", "reject", "suspend", "restore"]),
  note: z.string().trim().max(500).default(""),
});
export const adminPoolAssignSchema = z.object({ sellerOrderId: z.uuid(), riderId: z.uuid() });
export const riderModeSchema = z.object({ mode: z.enum(["townmart", "own"]) });
