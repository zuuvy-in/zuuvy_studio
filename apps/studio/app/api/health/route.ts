/**
 * Load balancer health check. Deliberately does not touch the database: a
 * database blip must not make the balancer kill every task at once and turn
 * a slow minute into an outage. The response names the build for deploy checks.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ok: true, version: process.env.APP_VERSION ?? "dev" });
}
