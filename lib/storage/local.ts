import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BucketName, StorageProvider, UploadTarget } from "./provider";

/**
 * Files on local disk, for development and tests when MinIO isn't running.
 * Uploads and private reads go through app routes (app/api/storage/*) with
 * HMAC-signed, expiring URLs, mirroring how presigned S3 URLs behave.
 * Refused in production by lib/env.ts.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  constructor(
    private readonly rootDir: string,
    private readonly appUrl: string,
    private readonly secret: string,
  ) {}

  /** Resolves a key inside the bucket directory, refusing path traversal. */
  filePath(bucket: BucketName, key: string): string {
    if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..") || key.startsWith("/")) {
      throw new Error("Invalid storage key");
    }
    return path.join(path.resolve(this.rootDir), bucket, key);
  }

  sign(parts: string[]): string {
    return createHmac("sha256", this.secret).update(parts.join("\n")).digest("base64url");
  }

  verify(parts: string[], signature: string): boolean {
    const expected = Buffer.from(this.sign(parts));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async createUploadUrl({ bucket, key, contentType, expiresInSeconds }: Parameters<StorageProvider["createUploadUrl"]>[0]): Promise<UploadTarget> {
    const exp = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
    const url = new URL("/api/storage/upload", this.appUrl);
    url.searchParams.set("bucket", bucket);
    url.searchParams.set("key", key);
    url.searchParams.set("ct", contentType);
    url.searchParams.set("exp", exp);
    url.searchParams.set("sig", this.sign(["put", bucket, key, contentType, exp]));
    return { url: url.toString(), method: "PUT", headers: { "Content-Type": contentType } };
  }

  async getObject(bucket: BucketName, key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.filePath(bucket, key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async putObject(bucket: BucketName, key: string, body: Buffer): Promise<void> {
    const file = this.filePath(bucket, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async deleteObject(bucket: BucketName, key: string): Promise<void> {
    await rm(this.filePath(bucket, key), { force: true });
  }

  async createReadUrl(bucket: BucketName, key: string, expiresInSeconds: number): Promise<string> {
    const exp = String(Math.floor(Date.now() / 1000) + expiresInSeconds);
    const url = new URL("/api/storage/read", this.appUrl);
    url.searchParams.set("bucket", bucket);
    url.searchParams.set("key", key);
    url.searchParams.set("exp", exp);
    url.searchParams.set("sig", this.sign(["get", bucket, key, exp]));
    return url.toString();
  }

  publicUrl(key: string): string {
    return `/api/storage/public/${key}`;
  }
}
