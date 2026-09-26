/**
 * Sealing integration credentials at rest: AES-256-GCM under `SECRETS_KEY`.
 *
 * Format: `v1.<keyId>.<iv>.<tag>.<ciphertext>` (base64url). The key id is
 * the first 8 hex chars of the key's SHA-256, so rotating keys later means
 * holding both and opening by id. In production the key is a KMS data key
 * (envelope encryption) rather than an environment variable; the format does
 * not change. Keys are per-row sealed values in the database — not one
 * Secrets Manager secret per tenant, which costs per secret per month.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config, isProduction } from "./config";

const DEV_KEY = createHash("sha256").update("zuuvy-site development key — never use in production").digest();

function key(): Buffer {
  const raw = config.secretsKey();
  if (!raw) {
    if (isProduction()) throw new Error("SECRETS_KEY is not set");
    return DEV_KEY;
  }
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64-encoded");
  return buf;
}

const keyId = (k: Buffer) => createHash("sha256").update(k).digest("hex").slice(0, 8);

export function seal(value: unknown): string {
  const k = key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", keyId(k), iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}

export function open<T = unknown>(sealed: string): T {
  const [v, id, iv, tag, ct] = sealed.split(".");
  if (v !== "v1" || !id || !iv || !tag || ct === undefined) throw new Error("not a sealed value");
  const k = key();
  if (id !== keyId(k)) throw new Error(`sealed with key ${id}, which is not the current key`);
  const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
