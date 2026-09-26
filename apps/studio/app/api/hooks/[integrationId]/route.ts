import { handleWebhook } from "@zsite/platform";

/**
 * Webhook receiver for every integration: `POST /api/hooks/<integration id>`.
 * The raw body is passed through untouched — the signature is over its bytes.
 * In production this runs as its own service behind the API host.
 */
export async function POST(request: Request, ctx: { params: Promise<{ integrationId: string }> }) {
  const { integrationId } = await ctx.params;
  const raw = await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  const result = await handleWebhook(integrationId, headers, raw);
  return Response.json(result.body, { status: result.status });
}
