import { z } from "zod";
import { lagosLocalToDate } from "@/lib/datetime";

/** Admin console content: homepage banners, featured stores, help centre and simple pages. */

const optionalLagosTime = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = lagosLocalToDate(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: "custom", message: "Choose a date and time" });
      return z.NEVER;
    }
    return d;
  });

/** Internal paths ("/deals") or https links only. */
const link = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^\/(?![/\\])\S*$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "Use a TownMart path like /deals, or an https:// link");

export const bannerSchema = z
  .object({
    id: z.uuid().optional(),
    title: z.string().trim().min(2, "Give the banner a headline").max(80),
    subtitle: z.string().trim().max(160).optional().default(""),
    imageKey: z
      .string()
      .max(200)
      .regex(/^(banners\/cms\/[A-Za-z0-9-]+\.webp)?$/, "Upload the image again")
      .optional()
      .default(""),
    linkUrl: link.optional().default(""),
    ctaLabel: z.string().trim().max(30).optional().default(""),
    sortOrder: z.coerce.number().int().min(0).max(999),
    startsAt: optionalLagosTime,
    endsAt: optionalLagosTime,
    isActive: z.boolean(),
  })
  .refine((b) => !b.startsAt || !b.endsAt || b.endsAt > b.startsAt, { message: "Must be after the start", path: ["endsAt"] })
  .refine((b) => !b.ctaLabel || b.linkUrl, { message: "Add a link for the button", path: ["linkUrl"] });
export type BannerInput = z.input<typeof bannerSchema>;

export const featuredStoresSchema = z.object({ businessIds: z.array(z.uuid()).max(12, "Feature up to 12 stores") });

export const faqSchema = z.object({
  id: z.uuid().optional(),
  section: z.string().trim().min(2, "Choose or type a section").max(60),
  question: z.string().trim().min(5, "Write the question").max(200),
  answerHtml: z.string().max(10_000).refine((v) => v.replace(/<[^>]*>/g, "").trim().length >= 5, "Write the answer"),
  sortOrder: z.coerce.number().int().min(0).max(999),
  isPublished: z.boolean(),
});
export type FaqInput = z.input<typeof faqSchema>;

export const CMS_PAGE_SLUGS = ["about", "contact"] as const;

export const cmsPageSchema = z.object({
  slug: z.enum(CMS_PAGE_SLUGS),
  title: z.string().trim().min(2).max(80),
  summary: z.string().trim().max(200).optional().default(""),
  bodyHtml: z.string().max(30_000).refine((v) => v.replace(/<[^>]*>/g, "").trim().length >= 10, "Write the page"),
});
export type CmsPageInput = z.input<typeof cmsPageSchema>;
