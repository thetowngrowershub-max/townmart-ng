import { randomUUID } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import { storage } from "./index";

/**
 * Upload pipeline:
 *  1. Browser compresses images (max 1600px, WebP) and asks for an upload URL.
 *  2. It PUTs the file straight to the PRIVATE bucket under `tmp/<businessId>/…`.
 *  3. The server "finalises": downloads, validates the real file type, re-encodes
 *     images (which strips EXIF/GPS), writes the result to its final bucket and
 *     deletes the temporary object.
 * Nothing a browser uploads is ever served without passing through step 3.
 */

export const IMAGE_PURPOSES = ["product", "service", "logo", "banner", "review"] as const;
export type ImagePurpose = (typeof IMAGE_PURPOSES)[number];

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ACCEPTED_DOCUMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const ACCEPTED_CSV_TYPES = ["text/csv", "application/vnd.ms-excel", "text/plain"] as const;

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

const IMAGE_LIMITS: Record<ImagePurpose, { width: number; height: number }> = {
  product: { width: 1600, height: 1600 },
  service: { width: 1600, height: 1600 },
  logo: { width: 512, height: 512 },
  banner: { width: 2400, height: 800 },
  review: { width: 1600, height: 1600 },
};

export class UploadError extends Error {}

export const tmpPrefix = (businessId: string) => `tmp/${businessId}/`;
export const newTmpKey = (businessId: string) => `${tmpPrefix(businessId)}${randomUUID()}`;

/**
 * Uploads by a customer (review photos) use `u-<userId>` where sellers' use
 * their business id, so the same tmp/ and ownership checks apply.
 */
export const customerOwner = (userId: string) => `u-${userId}`;

/** Public image keys are namespaced by business (or customer) so ownership can be checked from the key alone. */
export const imagePrefix = (purpose: ImagePurpose, businessId: string) => `${purpose}s/${businessId}/`;

async function takeTmp(businessId: string, tmpKey: string, maxBytes: number): Promise<Buffer> {
  if (!tmpKey.startsWith(tmpPrefix(businessId)) || !/^[A-Za-z0-9/_-]+$/.test(tmpKey)) {
    throw new UploadError("Upload not found");
  }
  const body = await storage().getObject("private", tmpKey);
  if (!body) throw new UploadError("Upload not found. Please try again.");
  await storage().deleteObject("private", tmpKey);
  if (body.length > maxBytes) throw new UploadError(`File is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  return body;
}

export type FinalisedImage = { key: string; width: number; height: number };

/** Validates and re-encodes an uploaded image into the public bucket. */
export async function finaliseImage(businessId: string, tmpKey: string, purpose: ImagePurpose): Promise<FinalisedImage> {
  const input = await takeTmp(businessId, tmpKey, MAX_IMAGE_BYTES);
  return processImage(input, businessId, purpose);
}

export async function processImage(input: Buffer, businessId: string, purpose: ImagePurpose): Promise<FinalisedImage> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: 40_000_000 }).metadata();
  } catch {
    throw new UploadError("That file isn't a readable image.");
  }
  if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) {
    throw new UploadError("Please upload a JPEG, PNG or WebP image.");
  }
  const limits = IMAGE_LIMITS[purpose];
  // rotate() applies the EXIF orientation; output carries no metadata (EXIF/GPS stripped).
  const { data, info } = await sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: limits.width, height: limits.height, fit: purpose === "banner" ? "cover" : "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });
  const key = `${imagePrefix(purpose, businessId)}${randomUUID()}.webp`;
  await storage().putObject("public", key, data, "image/webp");
  return { key, width: info.width, height: info.height };
}

/** KYC documents: PDFs are kept as-is after a magic-byte check; images are re-encoded to strip metadata. */
export async function finaliseDocument(businessId: string, tmpKey: string): Promise<{ key: string; contentType: string }> {
  const input = await takeTmp(businessId, tmpKey, MAX_DOCUMENT_BYTES);
  const base = `kyc/${businessId}/${randomUUID()}`;
  if (input.subarray(0, 5).toString("latin1") === "%PDF-") {
    await storage().putObject("private", `${base}.pdf`, input, "application/pdf");
    return { key: `${base}.pdf`, contentType: "application/pdf" };
  }
  try {
    const data = await sharp(input, { limitInputPixels: 40_000_000 }).rotate().jpeg({ quality: 90 }).toBuffer();
    await storage().putObject("private", `${base}.jpg`, data, "image/jpeg");
    return { key: `${base}.jpg`, contentType: "image/jpeg" };
  } catch {
    throw new UploadError("Please upload a PDF, JPEG, PNG or WebP file.");
  }
}

/** CSV imports stay private; returns the final key. */
export async function finaliseCsv(businessId: string, tmpKey: string): Promise<string> {
  const input = await takeTmp(businessId, tmpKey, MAX_CSV_BYTES);
  if (input.includes(0)) throw new UploadError("That file isn't a CSV.");
  const key = `imports/${businessId}/${randomUUID()}.csv`;
  await storage().putObject("private", key, input, "text/csv");
  return key;
}
