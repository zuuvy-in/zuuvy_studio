import { UserError, commerceSafeBack, submitForm } from "@zsite/platform";
import { type NextRequest, NextResponse } from "next/server";
import { currentSite } from "@/lib/site";

/**
 * A site's form, posted as a plain HTML form — no script needed on the page.
 * The answers are checked against the form as published and stored in its
 * table; the visitor goes back to the same page, to the form, with the outcome.
 */
export async function POST(request: NextRequest) {
  const current = await currentSite();
  const form = await request.formData();
  const get = (name: string) => {
    const v = form.get(name);
    return typeof v === "string" ? v : null;
  };
  const section = (get("_section") ?? "").slice(0, 40);
  const page = commerceSafeBack(get("_page") ?? "/");
  const back = (params: Record<string, string>) => {
    const q = new URLSearchParams(params).toString();
    // Relative Location: behind the balancer the request's own URL names the container.
    return new NextResponse(null, { status: 303, headers: { Location: `${page}?${q}#${encodeURIComponent(section)}` } });
  };
  if (!current) return new NextResponse("Not found", { status: 404 });
  try {
    await submitForm(current.resolved, { section, page, get, startedAt: Number(get("_t")) || undefined });
    return back({ form: section, sent: "1" });
  } catch (e) {
    if (e instanceof UserError) return back({ form: section, error: e.message.slice(0, 200) });
    throw e;
  }
}
