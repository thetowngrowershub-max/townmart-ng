import { z } from "zod";

/** Photos of past jobs a provider can show. Enough for a real portfolio, few enough to load on mobile data. */
export const MAX_PORTFOLIO_PHOTOS = 30;

export const portfolioInputSchema = z.object({
  photos: z
    .array(
      z.object({
        key: z.string().max(200),
        width: z.number().int().positive().max(10_000),
        height: z.number().int().positive().max(10_000),
        caption: z.string().trim().min(3, "Say what the job was (at least 3 characters)").max(160),
      }),
    )
    .max(MAX_PORTFOLIO_PHOTOS, `Up to ${MAX_PORTFOLIO_PHOTOS} photos`),
});
export type PortfolioInput = z.input<typeof portfolioInputSchema>;
