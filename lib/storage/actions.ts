"use server";

import { z } from "zod";
import { can } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { findViewableOrder } from "@/lib/orders/access";
import { rateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSellerContext } from "@/lib/seller/context";
import type { ActionResult } from "@/lib/validation/form-result";
import { storage, type UploadTarget } from "./index";
import {
  ACCEPTED_CSV_TYPES,
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  CMS_OWNER,
  customerOwner,
  finaliseEvidence,
  finaliseImage,
  MAX_CSV_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  newTmpKey,
  orderOwner,
  UploadError,
  type ImagePurpose,
} from "./uploads";

// Seller uploads. Review photos have their own actions below (customers, not sellers).
const UPLOAD_KINDS = ["product", "service", "logo", "banner", "kyc", "csv"] as const;
type UploadKind = (typeof UPLOAD_KINDS)[number];

const RULES: Record<UploadKind, { types: readonly string[]; maxBytes: number; permission: "listing.write" | "store.manage" | "import.manage" }> = {
  product: { types: ACCEPTED_IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, permission: "listing.write" },
  service: { types: ACCEPTED_IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, permission: "listing.write" },
  logo: { types: ACCEPTED_IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, permission: "store.manage" },
  banner: { types: ACCEPTED_IMAGE_TYPES, maxBytes: MAX_IMAGE_BYTES, permission: "store.manage" },
  kyc: { types: ACCEPTED_DOCUMENT_TYPES, maxBytes: MAX_DOCUMENT_BYTES, permission: "store.manage" },
  csv: { types: ACCEPTED_CSV_TYPES, maxBytes: MAX_CSV_BYTES, permission: "import.manage" },
};

const requestSchema = z.object({
  kind: z.enum(UPLOAD_KINDS),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

/**
 * Step 1 of an upload: a short-lived URL the browser PUTs the file to. The file
 * lands in the private bucket under tmp/<businessId>/ and is useless until a
 * finalise step validates and moves it.
 */
export async function requestUploadAction(input: z.input<typeof requestSchema>): Promise<ActionResult<{ tmpKey: string; target: UploadTarget }>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload request." };
  const { kind, contentType, size } = parsed.data;
  const rule = RULES[kind];

  const ctx = await getSellerContext();
  if (!ctx || !can(ctx.user, rule.permission, { businessId: ctx.business.id })) return { ok: false, error: "You can't upload files here." };
  if (!rule.types.includes(contentType)) return { ok: false, error: "That file type isn't supported." };
  if (size > rule.maxBytes) return { ok: false, error: `File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB).` };
  if (!(await rateLimit(`upload:${ctx.user.id}`, 60, 600)).allowed) return { ok: false, error: "Too many uploads. Please wait a few minutes." };

  const tmpKey = newTmpKey(ctx.business.id);
  const target = await storage().createUploadUrl({ bucket: "private", key: tmpKey, contentType, expiresInSeconds: 300 });
  return { ok: true, data: { tmpKey, target } };
}

const SELLER_IMAGE_PURPOSES = ["product", "service", "logo", "banner"] as const satisfies readonly ImagePurpose[];
const finaliseSchema = z.object({ tmpKey: z.string().max(200), purpose: z.enum(SELLER_IMAGE_PURPOSES) });

/** Step 2 for images: re-encode to WebP (stripping EXIF/GPS) into the public bucket. */
export async function finaliseImageAction(
  input: z.input<typeof finaliseSchema>,
): Promise<ActionResult<{ key: string; width: number; height: number; url: string }>> {
  const parsed = finaliseSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const ctx = await getSellerContext();
  if (!ctx || !can(ctx.user, RULES[parsed.data.purpose].permission, { businessId: ctx.business.id })) {
    return { ok: false, error: "You can't upload files here." };
  }
  try {
    const img = await finaliseImage(ctx.business.id, parsed.data.tmpKey, parsed.data.purpose);
    return { ok: true, data: { ...img, url: storage().publicUrl(img.key) } };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    logger.error({ err }, "image finalise failed");
    return { ok: false, error: "We couldn't process that image. Please try another." };
  }
}

const reviewRequestSchema = z.object({ contentType: z.string().max(100), size: z.number().int().positive() });

/** Review photos: any signed-in customer may upload; the review action checks the purchase and the key's owner. */
export async function requestReviewUploadAction(input: z.input<typeof reviewRequestSchema>): Promise<ActionResult<{ tmpKey: string; target: UploadTarget }>> {
  const parsed = reviewRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload request." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to add photos." };
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(parsed.data.contentType)) return { ok: false, error: "That file type isn't supported." };
  if (parsed.data.size > MAX_IMAGE_BYTES) return { ok: false, error: `File is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).` };
  if (!(await rateLimit(`upload:${user.id}`, 20, 600)).allowed) return { ok: false, error: "Too many uploads. Please wait a few minutes." };
  const tmpKey = newTmpKey(customerOwner(user.id));
  const target = await storage().createUploadUrl({ bucket: "private", key: tmpKey, contentType: parsed.data.contentType, expiresInSeconds: 300 });
  return { ok: true, data: { tmpKey, target } };
}

export async function finaliseReviewImageAction(input: { tmpKey: string }): Promise<ActionResult<{ key: string; width: number; height: number; url: string }>> {
  const tmpKey = z.string().max(200).safeParse(input.tmpKey);
  if (!tmpKey.success) return { ok: false, error: "Invalid upload." };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in to add photos." };
  try {
    const img = await finaliseImage(customerOwner(user.id), tmpKey.data, "review");
    return { ok: true, data: { ...img, url: storage().publicUrl(img.key) } };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    logger.error({ err }, "review image finalise failed");
    return { ok: false, error: "We couldn't process that image. Please try another." };
  }
}

const evidenceRequestSchema = z.object({
  orderNumber: z.string().regex(/^TM-\d{4}-\d{6,}$/),
  token: z.string().max(100).nullable().optional(),
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

/** Photos for a refund request: anyone who can open the order (its shopper, or a guest with the order link). */
export async function requestEvidenceUploadAction(input: z.input<typeof evidenceRequestSchema>): Promise<ActionResult<{ tmpKey: string; target: UploadTarget }>> {
  const parsed = evidenceRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload request." };
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(parsed.data.contentType)) return { ok: false, error: "Please choose a JPEG, PNG or WebP photo." };
  if (parsed.data.size > MAX_IMAGE_BYTES) return { ok: false, error: `File is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).` };
  const order = await findViewableOrder(parsed.data.orderNumber, parsed.data.token);
  if (!order) return { ok: false, error: "We couldn't find that order." };
  if (!(await rateLimit(`upload:order:${order.id}`, 20, 600)).allowed) return { ok: false, error: "Too many uploads. Please wait a few minutes." };
  const tmpKey = newTmpKey(orderOwner(order.id));
  const target = await storage().createUploadUrl({ bucket: "private", key: tmpKey, contentType: parsed.data.contentType, expiresInSeconds: 300 });
  return { ok: true, data: { tmpKey, target } };
}

export async function finaliseEvidenceAction(input: { orderNumber: string; token?: string | null; tmpKey: string }): Promise<ActionResult<{ key: string }>> {
  const parsed = evidenceRequestSchema.pick({ orderNumber: true, token: true }).extend({ tmpKey: z.string().max(200) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload." };
  const order = await findViewableOrder(parsed.data.orderNumber, parsed.data.token);
  if (!order) return { ok: false, error: "We couldn't find that order." };
  try {
    return { ok: true, data: await finaliseEvidence(order.id, parsed.data.tmpKey) };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    logger.error({ err }, "evidence finalise failed");
    return { ok: false, error: "We couldn't process that photo. Please try another." };
  }
}

/**
 * Homepage banners uploaded from the admin console. They're owned by `cms`
 * (keys under banners/cms/), so no seller can claim or replace them.
 */
export async function requestCmsUploadAction(input: z.input<typeof reviewRequestSchema>): Promise<ActionResult<{ tmpKey: string; target: UploadTarget }>> {
  const parsed = reviewRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid upload request." };
  const user = await getCurrentUser();
  if (!can(user, "content.manage")) return { ok: false, error: "You can't upload files here." };
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(parsed.data.contentType)) return { ok: false, error: "That file type isn't supported." };
  if (parsed.data.size > MAX_IMAGE_BYTES) return { ok: false, error: `File is too large (max ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).` };
  const tmpKey = newTmpKey(CMS_OWNER);
  const target = await storage().createUploadUrl({ bucket: "private", key: tmpKey, contentType: parsed.data.contentType, expiresInSeconds: 300 });
  return { ok: true, data: { tmpKey, target } };
}

export async function finaliseCmsImageAction(input: { tmpKey: string }): Promise<ActionResult<{ key: string; width: number; height: number; url: string }>> {
  const tmpKey = z.string().max(200).safeParse(input.tmpKey);
  if (!tmpKey.success) return { ok: false, error: "Invalid upload." };
  const user = await getCurrentUser();
  if (!can(user, "content.manage")) return { ok: false, error: "You can't upload files here." };
  try {
    const img = await finaliseImage(CMS_OWNER, tmpKey.data, "banner");
    return { ok: true, data: { ...img, url: storage().publicUrl(img.key) } };
  } catch (err) {
    if (err instanceof UploadError) return { ok: false, error: err.message };
    logger.error({ err }, "cms image finalise failed");
    return { ok: false, error: "We couldn't process that image. Please try another." };
  }
}
