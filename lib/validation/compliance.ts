import { z } from "zod";
import { COMPANY_KEYS } from "@/lib/legal/company";
import { RETENTION_KEYS } from "@/lib/compliance/retention";
import { commaList, lagosDateTime } from "./common";

const optionalDateTime = z
  .string()
  .optional()
  .transform((v, ctx) => {
    if (!v) return null;
    const parsed = lagosDateTime("Enter a date and time").safeParse(v);
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", message: "Enter a date and time" });
      return z.NEVER;
    }
    return parsed.data;
  });
const text = (max: number, message = "Fill this in") => z.string().trim().min(1, message).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);

export const dsrUpdateSchema = z.object({
  id: z.uuid(),
  status: z.enum(["in_progress", "completed", "rejected"]),
  note: z.string().trim().max(2000).optional(),
});

export const breachSchema = z
  .object({
    id: z.uuid().optional(),
    title: text(160, "Give it a short title"),
    description: text(5000, "Describe what happened"),
    detectedAt: lagosDateTime("When was it detected?"),
    awareAt: lagosDateTime("When did TownMart become aware?"),
    dataCategories: commaList(20, 60),
    subjectsAffected: z
      .string()
      .trim()
      .optional()
      .transform((v, ctx) => {
        if (!v) return null;
        if (!/^\d{1,9}$/.test(v)) {
          ctx.addIssue({ code: "custom", message: "Enter a number, or leave it blank if unknown" });
          return z.NEVER;
        }
        return Number(v);
      }),
    risk: z.enum(["low", "medium", "high"]),
    actions: optionalText(5000),
    status: z.enum(["open", "contained", "closed"]),
    ndpcNotifiedAt: optionalDateTime,
    ndpcReference: optionalText(120),
    subjectNotice: z.enum(["not_required", "pending", "sent"]),
    subjectsNotifiedAt: optionalDateTime,
  })
  .refine((b) => b.awareAt.getTime() >= b.detectedAt.getTime() - 86_400_000, { path: ["awareAt"], message: "Awareness can't be long before detection" })
  .refine((b) => b.subjectNotice !== "sent" || b.subjectsNotifiedAt, { path: ["subjectsNotifiedAt"], message: "When were people told?" });

export const activitySchema = z.object({
  id: z.uuid().optional(),
  name: text(120),
  purpose: text(2000),
  lawfulBasis: z.enum(["consent", "contract", "legal_obligation", "vital_interests", "public_interest", "legitimate_interests"]),
  dataSubjects: commaList(20, 60),
  dataCategories: commaList(30, 60),
  recipients: commaList(20, 80),
  transfers: optionalText(2000),
  retention: text(1000),
  security: optionalText(2000),
});

export const processorSchema = z.object({
  id: z.uuid().optional(),
  name: text(120),
  service: text(500),
  dataCategories: commaList(30, 60),
  location: text(200),
  safeguards: optionalText(1000),
  dpaSignedAt: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00+01:00`) : null)),
  website: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || null)
    .pipe(z.url({ error: "Enter a full web address" }).nullable()),
  active: z.boolean(),
});

export const dpiaSchema = z.object({
  id: z.uuid().optional(),
  title: text(160),
  activityId: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.uuid().nullable()),
  description: text(5000),
  risks: text(5000),
  mitigations: text(5000),
  residualRisk: z.enum(["low", "medium", "high"]),
  status: z.enum(["draft", "approved", "needs_review"]),
  nextReviewAt: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(`${v}T00:00:00+01:00`) : null)),
});

export const retentionSchema = z.object(Object.fromEntries(RETENTION_KEYS.map((k) => [k, z.coerce.number().int("Whole days only").min(1, "At least 1 day").max(3650, "At most 10 years")])) as Record<(typeof RETENTION_KEYS)[number], z.ZodCoercedNumber<unknown>>);

export const companySchema = z.object(Object.fromEntries(COMPANY_KEYS.map((k) => [k, z.string().trim().max(300)])) as Record<(typeof COMPANY_KEYS)[number], z.ZodString>);

export const legalPublishSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: text(120),
  summary: text(500),
  bodyHtml: text(200_000, "The page can't be empty"),
  effectiveAt: lagosDateTime("When does this version take effect?"),
  changeNote: optionalText(300),
  isTemplate: z.boolean(),
});
