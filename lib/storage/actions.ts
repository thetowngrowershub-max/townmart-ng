"use server";

import { z } from "zod";
import { can } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import { getSellerContext } from "@/lib/seller/context";
import type { ActionResult } from "@/lib/validation/form-result";
import { storage, type UploadTarget } from "./index";
import {
  ACCEPTED_CSV_TYPES,
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  finaliseImage,
  IMAGE_PURPOSES,
  MAX_CSV_BYTES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  newTmpKey,
  UploadError,
} from "./uploads";

const UPLOAD_KINDS = [...IMAGE_PURPOSES, "kyc", "csv"] as const;
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

const finaliseSchema = z.object({ tmpKey: z.string().max(200), purpose: z.enum(IMAGE_PURPOSES) });

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
