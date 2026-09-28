/**
 * The media library: pictures a business uploads, and pictures the AI makes
 * for it (Amazon Nova Canvas on Bedrock). Both end as an `assets` row plus a
 * public object; the AI is told what is in the library so it places the
 * business's own photos before generating anything.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { GeneratedImage, ImageAspect, ImageStyle } from "@zsite/ai";
import { loadRootEnv } from "./config";
import { type Tx, UserError, withTenant } from "./db";
import { storage } from "./storage";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type Asset = {
  id: string;
  site_id: string | null;
  url: string;
  kind: "upload" | "generated";
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  alt: string;
  prompt: string | null;
  created_at: Date;
};

const COLUMNS = "id, site_id, url, kind, content_type, bytes, width, height, alt, prompt, created_at";

/** The file's real type from its first bytes — never the name or the browser's claim. */
export function sniffImage(bytes: Uint8Array): { type: string; ext: string } | null {
  const b = bytes;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: "image/png", ext: "png" };
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { type: "image/webp", ext: "webp" };
  }
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: "image/gif", ext: "gif" };
  // SVG is refused on purpose: it is a document that can carry script.
  return null;
}

function requireStorage() {
  const s = storage();
  if (!s) throw new UserError("Picture storage is not configured on this server (ASSETS_BUCKET).");
  return s;
}

function objectKey(tenantId: string, ext: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return `t/${tenantId}/${day}/${crypto.randomUUID()}.${ext}`;
}

export async function listAssets(tx: Tx, limit = 60): Promise<Asset[]> {
  return tx.query<Asset>(`select ${COLUMNS} from assets order by created_at desc limit $1`, [limit]);
}

export type UploadInput = { bytes: Uint8Array; alt?: string; siteId?: string | null; userId: string };

export async function uploadAsset(tenantId: string, input: UploadInput): Promise<Asset> {
  if (!input.bytes.length) throw new UserError("Choose a picture to upload.");
  if (input.bytes.length > MAX_UPLOAD_BYTES) throw new UserError("Pictures must be under 5 MB.");
  const kind = sniffImage(input.bytes);
  if (!kind) throw new UserError("That file is not a JPEG, PNG, WebP or GIF picture.");
  const store = requireStorage();
  const key = objectKey(tenantId, kind.ext);
  // Upload first, outside any transaction; a row without bytes would be a broken picture.
  const url = await store.put(key, input.bytes, kind.type);
  return withTenant(tenantId, (tx) =>
    tx.get<Asset>(
      `insert into assets (tenant_id, site_id, storage_key, url, kind, content_type, bytes, alt, created_by)
       values (app_tenant(), $1, $2, $3, 'upload', $4, $5, $6, $7) returning ${COLUMNS}`,
      [input.siteId ?? null, key, url, kind.type, input.bytes.length, (input.alt ?? "").trim().slice(0, 300), input.userId],
    ),
  );
}

export async function updateAssetAlt(tx: Tx, id: string, alt: string): Promise<void> {
  await tx.get("update assets set alt = $2 where id = $1 returning id", [id, alt.trim().slice(0, 300)], "picture");
}

/**
 * Removes the row, then the object. A site that still shows the picture will
 * fall back to its placeholder — the studio warns before this is pressed.
 */
export async function deleteAsset(tenantId: string, id: string): Promise<void> {
  const row = await withTenant(tenantId, (tx) =>
    tx.get<{ storage_key: string }>("delete from assets where id = $1 returning storage_key", [id], "picture"),
  );
  await storage()?.delete(row.storage_key).catch(() => {});
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Sizes every supported model accepts: multiples of 16 (Nova Canvas) that are
 * also on Titan Image Generator's fixed list, so switching models by
 * environment variable never produces a size error.
 */
export const ASPECT_SIZES: Record<ImageAspect, { width: number; height: number }> = {
  wide: { width: 1408, height: 768 },
  landscape: { width: 1152, height: 896 },
  square: { width: 1024, height: 1024 },
  portrait: { width: 896, height: 1152 },
};

const STYLE_HINTS: Record<ImageStyle, string> = {
  photo: "professional photograph, natural light, sharp focus, high detail",
  illustration: "modern editorial illustration, clean shapes, soft gradients, cohesive palette",
  "3d": "soft 3D render, clay-like materials, studio lighting, gentle shadows",
  flat: "flat vector illustration, simple geometric shapes, limited palette, lots of whitespace",
};

const NEGATIVE = "text, letters, words, watermark, logo, signature, blurry, distorted, deformed hands, extra fingers";

export type ImageModel = { model: string; region: string };

export function imageModel(): ImageModel {
  loadRootEnv();
  return {
    // Nova Canvas is not served in Mumbai; us-east-1 is the default home for it.
    // amazon.titan-image-generator-v1 in ap-south-1 takes the same request body.
    model: process.env.ZSITE_IMAGE_MODEL || "amazon.nova-canvas-v1:0",
    region: process.env.ZSITE_IMAGE_REGION || "us-east-1",
  };
}

/** Anything with the client's `send`: the real Bedrock client, or a fake in tests. */
export type ImageSender = { send(command: InvokeModelCommand): Promise<{ body?: Uint8Array }> };

export async function renderImage(
  req: { prompt: string; aspect: ImageAspect; style: ImageStyle },
  opts: { client?: ImageSender; model?: ImageModel } = {},
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { model, region } = opts.model ?? imageModel();
  const size = ASPECT_SIZES[req.aspect];
  const client = opts.client ?? new BedrockRuntimeClient({ region });
  const text = `${req.prompt.trim()}. ${STYLE_HINTS[req.style]}`.slice(0, 1000);
  const body = {
    taskType: "TEXT_IMAGE",
    textToImageParams: { text, negativeText: NEGATIVE },
    imageGenerationConfig: { numberOfImages: 1, width: size.width, height: size.height, cfgScale: 7, quality: "standard" },
  };
  let res: { body?: Uint8Array };
  try {
    res = await client.send(
      new InvokeModelCommand({ modelId: model, contentType: "application/json", accept: "application/json", body: JSON.stringify(body) }),
    );
  } catch (e) {
    const err = e as Error & { name?: string };
    if (err.name === "ValidationException" && /operation not allowed/i.test(err.message)) {
      throw new UserError(`AWS has not allowed this account to use ${model} in ${region} yet — request a quota for it in the Bedrock console (${region}).`);
    }
    if (err.name === "ValidationException" && /blocked|filter|content/i.test(err.message)) {
      throw new UserError("The picture request was blocked by the image model's content filter. Describe it differently.");
    }
    if (err.name === "ThrottlingException" || err.name === "ServiceQuotaExceededException") {
      throw new UserError("The image model is busy or over its quota. Try again in a minute.");
    }
    throw new UserError(`Could not create the picture (${err.name ?? "error"}: ${err.message}).`);
  }
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { images?: string[]; error?: string };
  if (parsed.error || !parsed.images?.[0]) throw new UserError(`The image model returned no picture${parsed.error ? `: ${parsed.error}` : ""}.`);
  return { bytes: Buffer.from(parsed.images[0], "base64"), ...size };
}

/**
 * Generate, store, and record a picture. This is what the AI's generate_image
 * tool calls, and what the media page's "Generate" button calls.
 */
export async function generateAsset(
  tenantId: string,
  req: { prompt: string; aspect: ImageAspect; style: ImageStyle; siteId?: string | null; userId: string },
  opts: { client?: ImageSender; model?: ImageModel } = {},
): Promise<Asset> {
  const store = requireStorage();
  const image = await renderImage(req, opts);
  const key = objectKey(tenantId, "png");
  const url = await store.put(key, image.bytes, "image/png");
  return withTenant(tenantId, (tx) =>
    tx.get<Asset>(
      `insert into assets (tenant_id, site_id, storage_key, url, kind, content_type, bytes, width, height, alt, prompt, created_by)
       values (app_tenant(), $1, $2, $3, 'generated', 'image/png', $4, $5, $6, $7, $8, $9) returning ${COLUMNS}`,
      [req.siteId ?? null, key, url, image.bytes.length, image.width, image.height, req.prompt.slice(0, 300), req.prompt.slice(0, 1000), req.userId],
    ),
  );
}

/** Whether picture generation can be offered at all on this server. */
export function imagesAvailable(): boolean {
  loadRootEnv();
  return Boolean(storage()) && process.env.ZSITE_IMAGES !== "0";
}

export function generatedImage(a: Asset): GeneratedImage {
  return { url: a.url, width: a.width ?? 0, height: a.height ?? 0 };
}
