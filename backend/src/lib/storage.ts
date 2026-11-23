import fs from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

/**
 * Attachment storage. "s3" works with AWS S3, MinIO, and Google Cloud Storage
 * (via its S3-interoperable XML API: S3_ENDPOINT=https://storage.googleapis.com + HMAC keys).
 * "local" stores files on disk and streams them through the API.
 */
export interface Storage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Returns a URL to redirect to, or null if the caller should stream via `read`. */
  downloadUrl(key: string, filename: string): Promise<string | null>;
  read(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  /** Presigned PUT the browser uploads to directly (S3 only; bypasses serverless body-size limits). */
  uploadUrl?(key: string, contentType: string, size: number): Promise<string>;
  /** Size of a stored object, or null if it doesn't exist. */
  size?(key: string): Promise<number | null>;
}

const s3Client = (endpoint?: string) => new S3Client({
  region: env.S3_REGION,
  endpoint,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  // Only add checksums when an operation requires them. The SDK's default would bake a CRC32 of an empty
  // body into presigned PUT URLs, which S3 then rejects for the browser's real upload (and R2/GCS don't support it).
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: env.S3_ACCESS_KEY_ID ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
});

class S3Storage implements Storage {
  private client = s3Client(env.S3_ENDPOINT);
  /** Presigned URLs must use a host the browser can reach. */
  private signer = env.S3_PUBLIC_ENDPOINT ? s3Client(env.S3_PUBLIC_ENDPOINT) : this.client;
  constructor(private bucket: string) {}
  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }
  downloadUrl(key: string, filename: string) {
    return getSignedUrl(this.signer, new GetObjectCommand({
      Bucket: this.bucket, Key: key,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(filename)}"`,
    }), { expiresIn: 300 });
  }
  async read(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  uploadUrl(key: string, contentType: string, size: number) {
    // Content-Type and Content-Length are signed, so the upload must match what the API approved.
    return getSignedUrl(this.signer, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: 600 });
  }
  async size(key: string) {
    try {
      const r = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return r.ContentLength ?? 0;
    } catch (e) {
      if ((e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
}

class LocalStorage implements Storage {
  private root = path.resolve(env.LOCAL_UPLOAD_DIR);
  private file(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root + path.sep)) throw new Error("bad storage key");
    return p;
  }
  async put(key: string, body: Buffer) {
    await fs.mkdir(path.dirname(this.file(key)), { recursive: true });
    await fs.writeFile(this.file(key), body);
  }
  async downloadUrl() { return null; }
  read(key: string) { return fs.readFile(this.file(key)); }
  async remove(key: string) { await fs.rm(this.file(key), { force: true }); }
}

export const storage: Storage = env.STORAGE_DRIVER === "s3"
  ? new S3Storage(env.S3_BUCKET ?? (() => { throw new Error("S3_BUCKET is required when STORAGE_DRIVER=s3"); })())
  : new LocalStorage();
