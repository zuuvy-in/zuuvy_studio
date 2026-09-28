/**
 * Object storage for pictures (the media library). One S3 bucket; every object
 * under `t/<tenant>/` is publicly readable, because a website's images are
 * public by nature and a presigned URL — which changes on every request —
 * cannot be written into a site tree that is stored and served for months.
 *
 * Swappable: tests (and any local run without a bucket) use `memoryStorage`
 * or none at all, in which case uploads and generation say plainly that
 * storage is not configured instead of failing halfway.
 */
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadRootEnv } from "./config";

export type Storage = {
  put(key: string, body: Uint8Array, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  /** The object's bytes, or null when it is gone. For exports. */
  get(key: string): Promise<Uint8Array | null>;
};

let override: Storage | null | undefined;

/** For tests: replace the configured storage (null = none configured). */
export function setStorage(s: Storage | null | undefined): void {
  override = s;
}

export function storage(): Storage | null {
  if (override !== undefined) return override;
  loadRootEnv();
  const bucket = process.env.ASSETS_BUCKET;
  if (!bucket) return null;
  const region = process.env.ASSETS_REGION || process.env.AWS_REGION || "ap-south-1";
  const base = (process.env.ASSETS_BASE_URL || `https://${bucket}.s3.${region}.amazonaws.com`).replace(/\/+$/, "");
  const client = new S3Client({ region });
  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are unique per object, so the bytes behind a URL never change.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
      return `${base}/${key}`;
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return res.Body ? await res.Body.transformToByteArray() : null;
      } catch (e) {
        if ((e as { name?: string }).name === "NoSuchKey") return null;
        throw e;
      }
    },
  };
}

/** An in-memory store, for tests. */
export function memoryStorage(): Storage & { objects: Map<string, { body: Uint8Array; contentType: string }> } {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
      return `https://assets.test/${key}`;
    },
    async delete(key) {
      objects.delete(key);
    },
    async get(key) {
      return objects.get(key)?.body ?? null;
    },
  };
}
