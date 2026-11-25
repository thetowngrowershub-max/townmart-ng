import { z } from "zod";
import { emailSchema } from "./auth";

/** Requests a signed-in person sends to TownMart's queue (export and deletion have their own buttons). */
export const QUEUED_REQUEST_TYPES = ["rectification", "restriction", "objection", "withdraw_consent", "other"] as const;

export const privacyRequestSchema = z.object({
  type: z.enum(QUEUED_REQUEST_TYPES, { error: "Choose what you'd like us to do" }),
  details: z.string().trim().min(10, "Tell us a little more, so we can act on it").max(4000, "Keep it under 4,000 characters"),
});

export const rectifyNameSchema = z.object({ name: z.string().trim().min(2, "Enter your name").max(80) });

export const deletionSchema = z.object({
  confirm: z.literal("DELETE", { error: "Type DELETE to confirm" }),
  reason: z.string().trim().max(1000).optional(),
});

export const PUBLIC_REQUEST_TYPES = ["access", "portability", "rectification", "erasure", "restriction", "objection", "withdraw_consent", "other"] as const;

export const publicDataRequestSchema = z.object({
  name: z.string().trim().min(2, "Enter your name").max(80),
  email: emailSchema,
  type: z.enum(PUBLIC_REQUEST_TYPES, { error: "Choose a request" }),
  details: z.string().trim().max(4000, "Keep it under 4,000 characters").optional(),
  turnstileToken: z.string().optional(),
});
