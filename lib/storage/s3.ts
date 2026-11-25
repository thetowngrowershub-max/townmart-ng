import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { BucketName, StorageProvider, UploadTarget } from "./provider";

type S3Config = {
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl?: string;
};

/** MinIO in development; MinIO on our own server, Cloudflare R2 or AWS S3 in production. */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly client: S3Client;

  constructor(private readonly config: S3Config) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials:
        config.accessKeyId && config.secretAccessKey
          ? { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
          : undefined,
    });
  }

  private bucket(name: BucketName) {
    return name === "public" ? this.config.publicBucket : this.config.privateBucket;
  }

  async createUploadUrl({ bucket, key, contentType, expiresInSeconds }: Parameters<StorageProvider["createUploadUrl"]>[0]): Promise<UploadTarget> {
    const command = new PutObjectCommand({ Bucket: this.bucket(bucket), Key: key, ContentType: contentType });
    const url = await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
    return { url, method: "PUT", headers: { "Content-Type": contentType } };
  }

  async getObject(bucket: BucketName, key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return null;
      throw err;
    }
  }

  async putObject(bucket: BucketName, key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket(bucket),
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: bucket === "public" ? "public, max-age=31536000, immutable" : "private, no-store",
      }),
    );
  }

  async deleteObject(bucket: BucketName, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket(bucket), Key: key }));
  }

  createReadUrl(bucket: BucketName, key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket(bucket), Key: key }), {
      expiresIn: expiresInSeconds,
    });
  }

  publicUrl(key: string): string {
    const base = this.config.publicBaseUrl ?? `${this.config.endpoint}/${this.config.publicBucket}`;
    return `${base.replace(/\/$/, "")}/${key}`;
  }
}
