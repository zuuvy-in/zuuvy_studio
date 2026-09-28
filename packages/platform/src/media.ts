/**
 * The media library: pictures a business uploads, and pictures the AI makes
 * for it (Amazon Nova Canvas on Bedrock). Both end as an `assets` row plus a
 * public object; the AI is told what is in the library so it places the
 * business's own photos before generating anything.
 */
import { BedrockClient, ListFoundationModelsCommand, ListInferenceProfilesCommand } from "@aws-sdk/client-bedrock";
import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
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
    // Nova 2 Omni generates images through Converse and is reached from Mumbai by
    // its global inference profile. Nova Canvas (amazon.nova-canvas-v1:0, us-east-1)
    // still works for accounts that used it recently; AWS marks it Legacy.
    model: process.env.ZSITE_IMAGE_MODEL || "global.amazon.nova-2-omni-v1:0",
    region: process.env.ZSITE_IMAGE_REGION || process.env.AWS_REGION || "ap-south-1",
  };
}

/** Canvas and Titan take one JSON request body; everything else speaks Converse. */
export function imageApi(model: string): "invoke" | "converse" {
  return /nova-canvas|titan-image/.test(model) ? "invoke" : "converse";
}

/** Anything with the client's `send`: the real Bedrock client, or a fake in tests. */
export type ImageSender = { send(command: InvokeModelCommand | ConverseCommand): Promise<unknown> };

const ASPECT_WORDS: Record<ImageAspect, string> = {
  wide: "a wide 16:9 landscape image",
  landscape: "a 4:3 landscape image",
  square: "a square 1:1 image",
  portrait: "a 3:4 portrait image",
};

/** Pixel size from the file itself (PNG IHDR, or a JPEG SOF marker). */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b.length > 24) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length; ) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1]!;
      const len = (b[i + 2]! << 8) | b[i + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]! };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * Which image model this account can actually call from `region`, asked of
 * Bedrock itself: an inference profile for Nova 2 Omni first, else any active
 * Amazon model that outputs images. Model ids and profile prefixes differ by
 * region and change as AWS retires models, so a configured id that turns out
 * invalid is replaced by what Bedrock lists rather than by a guess.
 */
const discovered = new Map<string, string | null>();

export type ModelLister = {
  send(command: ListInferenceProfilesCommand | ListFoundationModelsCommand): Promise<unknown>;
};

export async function discoverImageModel(region: string, lister?: ModelLister): Promise<string | null> {
  if (!lister && discovered.has(region)) return discovered.get(region)!;
  const client = lister ?? new BedrockClient({ region });
  let found: string | null = null;
  try {
    const profiles = (await client.send(new ListInferenceProfilesCommand({ maxResults: 1000 }))) as {
      inferenceProfileSummaries?: { inferenceProfileId?: string; status?: string }[];
    };
    const ids = (profiles.inferenceProfileSummaries ?? [])
      .filter((p) => p.status !== "INACTIVE")
      .map((p) => p.inferenceProfileId ?? "")
      .filter((id) => /nova-2-omni/.test(id));
    // A profile for this geography before a global one.
    found = ids.find((id) => !id.startsWith("global.")) ?? ids[0] ?? null;
  } catch {
    /* no permission to list profiles: fall through to the model list */
  }
  if (!found) {
    try {
      const models = (await client.send(new ListFoundationModelsCommand({ byOutputModality: "IMAGE", byProvider: "Amazon" }))) as {
        modelSummaries?: { modelId?: string; modelLifecycle?: { status?: string }; inferenceTypesSupported?: string[] }[];
      };
      const active = (models.modelSummaries ?? []).filter(
        (m) => m.modelLifecycle?.status !== "LEGACY" && (m.inferenceTypesSupported ?? ["ON_DEMAND"]).includes("ON_DEMAND"),
      );
      found = (active.find((m) => /omni/.test(m.modelId ?? "")) ?? active[0])?.modelId ?? null;
    } catch {
      /* nothing listable either */
    }
  }
  if (!lister) discovered.set(region, found);
  return found;
}

const replaceable = (e: unknown) => /model identifier is invalid|legacy|not found|doesn't support|does not support/i.test((e as Error).message ?? "");

function explainImageError(e: unknown, model: string, region: string): never {
  const err = e as Error & { name?: string };
  if (/legacy/i.test(err.message)) {
    throw Object.assign(new UserError(`${model} is a legacy model this account cannot use.`), { cause: e });
  }
  if ((err.name === "ValidationException" && /operation not allowed/i.test(err.message)) || err.name === "AccessDeniedException") {
    throw new UserError(`AWS has not allowed this account to use ${model} from ${region} yet — check its quota in the Bedrock console (${region}).`);
  }
  if (err.name === "ValidationException" && /blocked|filter|content/i.test(err.message)) {
    throw new UserError("The picture request was blocked by the image model's content filter. Describe it differently.");
  }
  if (err.name === "ThrottlingException" || err.name === "ServiceQuotaExceededException") {
    throw new UserError("The image model is busy or over its quota. Try again in a minute.");
  }
  throw Object.assign(new UserError(`Could not create the picture (${err.name ?? "error"}: ${err.message}).`), { cause: e });
}

type Rendered = { bytes: Uint8Array; width: number; height: number; contentType: string; ext: string };

export async function renderImage(
  req: { prompt: string; aspect: ImageAspect; style: ImageStyle },
  opts: { client?: ImageSender; model?: ImageModel; lister?: ModelLister } = {},
): Promise<Rendered> {
  const chosen = opts.model ?? imageModel();
  try {
    return await renderWith(req, chosen, opts.client);
  } catch (e) {
    if (!replaceable((e as { cause?: unknown }).cause ?? e)) throw e;
    // The configured id is not callable here: ask Bedrock what is, once.
    const alternative = await discoverImageModel(chosen.region, opts.lister);
    if (!alternative || alternative === chosen.model) {
      throw new UserError(
        `No image model this account can use from ${chosen.region}: ${chosen.model} was refused ("${String(((e as { cause?: Error }).cause ?? (e as Error)).message).slice(0, 160)}") and Bedrock lists no active alternative. Set ZSITE_IMAGE_MODEL (and ZSITE_IMAGE_REGION) to one the account can call.`,
      );
    }
    return renderWith(req, { model: alternative, region: chosen.region }, opts.client);
  }
}

async function renderWith(
  req: { prompt: string; aspect: ImageAspect; style: ImageStyle },
  { model, region }: ImageModel,
  client0?: ImageSender,
): Promise<Rendered> {
  const size = ASPECT_SIZES[req.aspect];
  const client = client0 ?? new BedrockRuntimeClient({ region });
  const text = `${req.prompt.trim()}. ${STYLE_HINTS[req.style]}`.slice(0, 1000);

  if (imageApi(model) === "converse") {
    let res: ConverseCommandOutput;
    try {
      res = (await client.send(
        new ConverseCommand({
          modelId: model,
          messages: [
            {
              role: "user",
              content: [
                {
                  text: `Generate ${ASPECT_WORDS[req.aspect]}: ${text}. No text, letters, logos or watermarks in the image. Reply with the image only.`,
                },
              ],
            },
          ],
        }),
      )) as ConverseCommandOutput;
    } catch (e) {
      explainImageError(e, model, region);
    }
    const block = res.output?.message?.content?.find((c) => "image" in c && c.image)?.image;
    const bytes = block?.source && "bytes" in block.source ? block.source.bytes : undefined;
    if (!bytes?.length) {
      if (res.stopReason === "content_filtered" || res.stopReason === "guardrail_intervened") {
        throw new UserError("The picture request was blocked by the image model's content filter. Describe it differently.");
      }
      throw new UserError(`${model} answered without a picture. Try describing it differently.`);
    }
    const format = (block?.format ?? "png") as string;
    const dims = imageSize(bytes) ?? size;
    return { bytes, ...dims, contentType: `image/${format === "jpg" ? "jpeg" : format}`, ext: format === "jpeg" ? "jpg" : format };
  }

  const body = {
    taskType: "TEXT_IMAGE",
    textToImageParams: { text, negativeText: NEGATIVE },
    imageGenerationConfig: { numberOfImages: 1, width: size.width, height: size.height, cfgScale: 7, quality: "standard" },
  };
  let res: { body?: Uint8Array };
  try {
    res = (await client.send(
      new InvokeModelCommand({ modelId: model, contentType: "application/json", accept: "application/json", body: JSON.stringify(body) }),
    )) as { body?: Uint8Array };
  } catch (e) {
    explainImageError(e, model, region);
  }
  const parsed = JSON.parse(new TextDecoder().decode(res.body)) as { images?: string[]; error?: string };
  if (parsed.error || !parsed.images?.[0]) throw new UserError(`The image model returned no picture${parsed.error ? `: ${parsed.error}` : ""}.`);
  return { bytes: Buffer.from(parsed.images[0], "base64"), ...size, contentType: "image/png", ext: "png" };
}

/**
 * Generate, store, and record a picture. This is what the AI's generate_image
 * tool calls, and what the media page's "Generate" button calls.
 */
export async function generateAsset(
  tenantId: string,
  req: { prompt: string; aspect: ImageAspect; style: ImageStyle; siteId?: string | null; userId: string },
  opts: { client?: ImageSender; model?: ImageModel; lister?: ModelLister } = {},
): Promise<Asset> {
  const store = requireStorage();
  const image = await renderImage(req, opts);
  const key = objectKey(tenantId, image.ext);
  const url = await store.put(key, image.bytes, image.contentType);
  return withTenant(tenantId, (tx) =>
    tx.get<Asset>(
      `insert into assets (tenant_id, site_id, storage_key, url, kind, content_type, bytes, width, height, alt, prompt, created_by)
       values (app_tenant(), $1, $2, $3, 'generated', $10, $4, $5, $6, $7, $8, $9) returning ${COLUMNS}`,
      [req.siteId ?? null, key, url, image.bytes.length, image.width, image.height, req.prompt.slice(0, 300), req.prompt.slice(0, 1000), req.userId, image.contentType],
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
