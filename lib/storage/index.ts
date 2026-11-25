import { env } from "@/lib/env";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./provider";
import { S3StorageProvider } from "./s3";

export type { BucketName, StorageProvider, UploadTarget } from "./provider";

let provider: StorageProvider | undefined;

export function storage(): StorageProvider {
  if (!provider) {
    const e = env();
    provider =
      e.STORAGE_DRIVER === "local"
        ? new LocalStorageProvider(e.LOCAL_STORAGE_DIR, e.APP_URL, e.AUTH_SECRET)
        : new S3StorageProvider({
            endpoint: e.S3_ENDPOINT,
            region: e.S3_REGION,
            accessKeyId: e.S3_ACCESS_KEY_ID,
            secretAccessKey: e.S3_SECRET_ACCESS_KEY,
            forcePathStyle: e.S3_FORCE_PATH_STYLE,
            publicBucket: e.S3_PUBLIC_BUCKET,
            privateBucket: e.S3_PRIVATE_BUCKET,
            publicBaseUrl: e.S3_PUBLIC_BASE_URL,
          });
  }
  return provider;
}

/** URL for a public image key. Safe to call in Server Components. */
export function publicImageUrl(key: string): string {
  return storage().publicUrl(key);
}
