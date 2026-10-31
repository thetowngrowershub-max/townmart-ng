"use client";

import {
  finaliseCmsImageAction,
  finaliseEvidenceAction,
  finaliseImageAction,
  finaliseReviewImageAction,
  requestCmsUploadAction,
  requestEvidenceUploadAction,
  requestReviewUploadAction,
  requestUploadAction,
} from "@/lib/storage/actions";
import type { ImagePurpose } from "@/lib/storage/uploads";

export type UploadedImage = { key: string; url: string; width: number; height: number };

export const MAX_EDGE = { product: 1600, service: 1600, logo: 512, banner: 2400, review: 1600 } satisfies Record<ImagePurpose, number>;

/**
 * Shrinks an image in the browser before upload (max edge, WebP) so sellers on
 * mobile data don't push 8 MB camera photos. The server re-encodes anyway; if
 * the browser can't decode or encode, the original file is sent.
 */
export async function compressImage(file: File, maxEdge: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
    return blob && blob.type === "image/webp" && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

async function putToStorage(kind: Parameters<typeof requestUploadAction>[0]["kind"], body: Blob): Promise<string> {
  const req = await requestUploadAction({ kind, contentType: body.type, size: body.size });
  if (!req.ok) throw new Error(req.error);
  const { tmpKey, target } = req.data!;
  const res = await fetch(target.url, { method: target.method, headers: target.headers, body });
  if (!res.ok) throw new Error("Upload failed. Check your connection and try again.");
  return tmpKey;
}

/** Compress → presigned PUT → server re-encode. Returns the final public image. */
export async function uploadImage(file: File, purpose: ImagePurpose): Promise<UploadedImage> {
  const body = await compressImage(file, MAX_EDGE[purpose]);
  if (purpose === "review") {
    const req = await requestReviewUploadAction({ contentType: body.type, size: body.size });
    if (!req.ok) throw new Error(req.error);
    const { tmpKey, target } = req.data!;
    const res = await fetch(target.url, { method: target.method, headers: target.headers, body });
    if (!res.ok) throw new Error("Upload failed. Check your connection and try again.");
    const fin = await finaliseReviewImageAction({ tmpKey });
    if (!fin.ok) throw new Error(fin.error);
    return fin.data!;
  }
  const tmpKey = await putToStorage(purpose, body);
  const fin = await finaliseImageAction({ tmpKey, purpose });
  if (!fin.ok) throw new Error(fin.error);
  return fin.data!;
}

/** A homepage banner uploaded from the admin console. */
export async function uploadCmsBanner(file: File): Promise<UploadedImage> {
  const body = await compressImage(file, MAX_EDGE.banner);
  const req = await requestCmsUploadAction({ contentType: body.type, size: body.size });
  if (!req.ok) throw new Error(req.error);
  const { tmpKey, target } = req.data!;
  const res = await fetch(target.url, { method: target.method, headers: target.headers, body });
  if (!res.ok) throw new Error("Upload failed. Check your connection and try again.");
  const fin = await finaliseCmsImageAction({ tmpKey });
  if (!fin.ok) throw new Error(fin.error);
  return fin.data!;
}

/** A photo for a refund request: private, readable only by the customer, the seller and TownMart. */
export async function uploadEvidence(file: File, order: { orderNumber: string; token: string | null }): Promise<string> {
  const body = await compressImage(file, 1600);
  const req = await requestEvidenceUploadAction({ ...order, contentType: body.type, size: body.size });
  if (!req.ok) throw new Error(req.error);
  const { tmpKey, target } = req.data!;
  const res = await fetch(target.url, { method: target.method, headers: target.headers, body });
  if (!res.ok) throw new Error("Upload failed. Check your connection and try again.");
  const fin = await finaliseEvidenceAction({ ...order, tmpKey });
  if (!fin.ok) throw new Error(fin.error);
  return fin.data!.key;
}

/** KYC documents and CSVs: uploaded as-is to the private bucket; the form's action finalises them. */
export async function uploadPrivateFile(file: File, kind: "kyc" | "csv"): Promise<string> {
  const type = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/octet-stream");
  return putToStorage(kind, new Blob([file], { type }));
}
