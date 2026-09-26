/**
 * Webhook signatures: `X-Zuuvy-Signature: t=<unix seconds>,v1=<hex>` where
 * v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). The timestamp is inside the
 * MAC so a captured delivery cannot be replayed later with a fresh `t`, and a
 * delivery older than the tolerance is refused outright.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOLERANCE_SECONDS = 300;

export function sign(secret: string, rawBody: string, at: Date = new Date()): string {
  const t = Math.floor(at.getTime() / 1000);
  const mac = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return `t=${t},v1=${mac}`;
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export function verify(
  secret: string,
  header: string | undefined,
  rawBody: string,
  now: Date = new Date(),
): VerifyResult {
  if (!header) return { ok: false, reason: "missing signature" };
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  const given = parts.v1;
  if (!Number.isFinite(t) || !given) return { ok: false, reason: "malformed signature" };
  if (Math.abs(now.getTime() / 1000 - t) > TOLERANCE_SECONDS) {
    return { ok: false, reason: "signature timestamp outside tolerance" };
  }
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  let givenBytes: Buffer;
  try {
    givenBytes = Buffer.from(given, "hex");
  } catch {
    return { ok: false, reason: "malformed signature" };
  }
  if (givenBytes.length !== expected.length || !timingSafeEqual(givenBytes, expected)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
