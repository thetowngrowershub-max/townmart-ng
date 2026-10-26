/**
 * Object storage behind an interface so TownMart isn't tied to one vendor.
 * Two logical buckets:
 *  - public:  product/service/store images, served to everyone
 *  - private: KYC documents, CSV imports, data exports, and unprocessed uploads.
 *             Read only through short-lived signed URLs.
 */
export type BucketName = "public" | "private";

export type UploadTarget = {
  url: string;
  method: "PUT";
  headers: Record<string, string>;
};

export interface StorageProvider {
  readonly name: string;
  /** A short-lived URL the browser can PUT a file to directly. */
  createUploadUrl(params: { bucket: BucketName; key: string; contentType: string; expiresInSeconds: number }): Promise<UploadTarget>;
  getObject(bucket: BucketName, key: string): Promise<Buffer | null>;
  putObject(bucket: BucketName, key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(bucket: BucketName, key: string): Promise<void>;
  /** Short-lived read URL for a private object. */
  createReadUrl(bucket: BucketName, key: string, expiresInSeconds: number): Promise<string>;
  /** Permanent URL of a public object. */
  publicUrl(key: string): string;
}
