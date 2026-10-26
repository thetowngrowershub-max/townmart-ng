import { z } from "zod";
import { emailSchema } from "./auth";
import { nigerianPhone } from "./common";

const text = (min: number, max: number, message: string) => z.string().trim().min(min, message).max(max);

export const newAddressSchema = z.object({
  recipientName: text(2, 80, "Enter the recipient's name"),
  phone: nigerianPhone,
  line1: text(5, 200, "Enter the street address"),
  line2: z.string().trim().max(200).optional().or(z.literal("")),
  landmark: z.string().trim().max(120).optional().or(z.literal("")),
  city: text(2, 60, "Enter the town or city"),
  stateId: z.coerce.number().int().positive({ error: "Choose a state" }),
  lgaId: z.coerce.number().int().positive({ error: "Choose an LGA" }),
});

export const PAYMENT_CHOICES = ["online", "pay_on_delivery"] as const;

export const checkoutSchema = z
  .object({
    // Guests give an email for the receipt; signed-in shoppers use their account email.
    email: emailSchema.optional().or(z.literal("")),
    addressId: z.uuid().optional().or(z.literal("")),
    address: newAddressSchema.optional(),
    saveAddress: z.boolean().default(false),
    methods: z.record(z.uuid(), z.enum(["delivery", "pickup"])).default({}),
    payment: z.enum(PAYMENT_CHOICES),
    acceptTerms: z.literal(true, { error: "Please accept the Terms of Use and Refund Policy" }),
    marketingConsent: z.boolean().default(false),
    // The total the shopper saw; the order is refused if prices changed since.
    expectedTotalKobo: z.string().regex(/^\d{1,15}$/),
  })
  .superRefine((v, ctx) => {
    if (!v.addressId && !v.address) ctx.addIssue({ code: "custom", path: ["addressId"], message: "Choose or add a delivery address" });
  });

export type CheckoutInput = z.input<typeof checkoutSchema>;
export type CheckoutData = z.output<typeof checkoutSchema>;

export const quoteRequestSchema = z.object({
  addressId: z.uuid().optional().or(z.literal("")),
  stateId: z.coerce.number().int().positive().optional(),
  lgaId: z.coerce.number().int().positive().optional(),
  methods: z.record(z.uuid(), z.enum(["delivery", "pickup"])).default({}),
});
