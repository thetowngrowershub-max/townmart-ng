import { z } from "zod";
import { SHOPPER_REPORT_REASONS } from "@/lib/moderation/labels";

const listing = { kind: z.enum(["product", "service"]), id: z.uuid() };

export const reportListingSchema = z.object({
  ...listing,
  reason: z.enum(SHOPPER_REPORT_REASONS, { message: "Choose a reason." }),
  details: z.string().trim().max(1000, "Keep it under 1,000 characters.").optional().default(""),
});

export const takeDownSchema = z.object({
  ...listing,
  reason: z.string().trim().min(10, "Tell the seller why, in a sentence or two.").max(1000),
});

export const listingRefSchema = z.object(listing);

export const dismissSchema = z.object({ ...listing, note: z.string().trim().min(3, "Add a short note.").max(500) });

export const reviewModerationSchema = z.object({ id: z.uuid(), action: z.enum(["hide", "publish"]) });

export const questionModerationSchema = z.object({ id: z.uuid(), action: z.enum(["hide", "publish"]) });

export const keywordsSchema = z.object({ text: z.string().max(10_000) });

export const askQuestionSchema = z.object({ ...listing, question: z.string().trim().min(5, "Ask a little more.").max(500, "Keep it under 500 characters.") });

export const answerQuestionSchema = z.object({ id: z.uuid(), answer: z.string().trim().min(2, "Write an answer.").max(2000) });
