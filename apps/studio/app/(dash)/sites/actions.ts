"use server";

import { type Brand, COLOR_KEYS, FONTS, MOTIONS } from "@zsite/core";
import {
  UserError,
  addDomain,
  applyProposals,
  checkDomainNow,
  connectGit,
  createSite,
  deleteSite,
  disconnectGit,
  generateVersion,
  getVersionByNumber,
  importFromBranch,
  importRevision,
  importSite,
  isPlatformAdmin,
  NotFound,
  type Plan,
  parsePlan,
  planVersion,
  publishVersion,
  removeDomain,
  renameSite,
  restoreVersion,
  saveBrand,
  setInventory,
  setOutOfStock,
  setSiteAccounts,
  setSiteKind,
  toAttachments,
  uploadAsset,
  withTenant,
} from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Uploaded files from a form field, as bytes (an empty file input sends one empty File). */
async function filesOf(form: FormData, key: string): Promise<{ name: string; bytes: Uint8Array }[]> {
  const out: { name: string; bytes: Uint8Array }[] = [];
  for (const v of form.getAll(key)) {
    if (typeof v === "string" || v.size === 0) continue;
    out.push({ name: v.name, bytes: new Uint8Array(await v.arrayBuffer()) });
  }
  return out;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * The brand kit fields of a form: a colour counts only when its "set" box is
 * ticked, so an untouched picker (which always holds some value) never fixes
 * a colour the owner meant to leave to the AI.
 */
function brandFromForm(form: FormData, logo?: string): Brand {
  const colors: Brand["colors"] = {};
  for (const k of COLOR_KEYS) {
    const v = text(form, `color_${k}`);
    if (form.get(`set_${k}`) && HEX.test(v)) colors[k] = v.toLowerCase();
  }
  const fonts: Brand["fonts"] = {};
  for (const k of ["heading", "body"] as const) {
    const v = text(form, `font_${k}`);
    if ((FONTS as readonly string[]).includes(v)) fonts[k] = v as (typeof FONTS)[number];
  }
  const motion = text(form, "motion");
  const guidelines = text(form, "guidelines").slice(0, 3000);
  const existingLogo = text(form, "logo_url");
  const chosen = logo ?? (form.get("remove_logo") ? "" : existingLogo);
  return {
    colors,
    fonts,
    ...(chosen && /^https:\/\//.test(chosen) ? { logo: chosen } : {}),
    ...((MOTIONS as readonly string[]).includes(motion) ? { motion: motion as Brand["motion"] } : {}),
    ...(guidelines ? { guidelines } : {}),
  };
}

async function logoFrom(form: FormData, tenantId: string, userId: string, siteId: string | null): Promise<string | undefined> {
  const [file] = await filesOf(form, "logo");
  if (!file) return undefined;
  const asset = await uploadAsset(tenantId, { bytes: file.bytes, alt: "Logo", siteId, userId });
  return asset.url;
}

export async function createSiteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const logo = await logoFrom(form, session.tenant.id, session.user.id, null);
    const brand = brandFromForm(form, logo);
    const site = await withTenant(session.tenant.id, (tx) =>
      createSite(tx, {
        brand,
        name: text(form, "name"),
        subdomain: text(form, "subdomain"),
        templateId: text(form, "template"),
        templateInput: {
          businessName: session.tenant.name,
          tagline: text(form, "tagline") || undefined,
          email: session.user.email,
        },
        userId: session.user.id,
      }),
    );
    // Arrived from the landing page with something to build: the builder opens with it.
    const prompt = text(form, "prompt").slice(0, 1000);
    redirect(`/sites/${site.id}/versions${prompt ? `?prompt=${encodeURIComponent(prompt)}` : ""}`);
  });
}

export async function publishAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const number = Number(text(form, "number"));
    await withTenant(session.tenant.id, async (tx) => {
      const v = await getVersionByNumber(tx, siteId, number);
      await publishVersion(tx, siteId, v.id, session.user.id);
    });
    revalidatePath(`/sites/${siteId}`, "layout");
    return { ok: `Version ${number} is live.` };
  });
}

export async function restoreAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const number = Number(text(form, "number"));
    // From the version page the owner chooses: the layout, and which tables to reset from this version.
    const chose = form.get("choose") === "1";
    const created = await withTenant(session.tenant.id, async (tx) => {
      const v = await getVersionByNumber(tx, siteId, number);
      return restoreVersion(
        tx,
        siteId,
        v.id,
        session.user.id,
        chose ? { restoreLayout: form.get("layout") === "1", resetCollections: form.getAll("tables").map(String) } : {},
      );
    });
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${created.number}`);
  });
}

/** The request as the composer sent it: the words, any reference links, any files. */
async function requestFrom(form: FormData) {
  const links = text(form, "links")
    .split(/\s+/)
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, 3);
  const prompt = text(form, "prompt") + (links.length ? `\n\nReference websites (look at them first): ${links.join(" ")}` : "");
  const attachments = toAttachments(await filesOf(form, "files"));
  return { prompt, attachments };
}

export async function generateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const baseNumber = Number(text(form, "base"));
    const base = await withTenant(session.tenant.id, (tx) => getVersionByNumber(tx, siteId, baseNumber));
    const { prompt, attachments } = await requestFrom(form);
    const rawPlan = text(form, "plan");
    const created = await generateVersion(session.tenant.id, {
      siteId,
      baseVersionId: base.id,
      prompt,
      userId: session.user.id,
      attachments,
      ...(rawPlan ? { plan: parsePlan(rawPlan), planNotes: text(form, "planNotes").slice(0, 2000) } : {}),
    });
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${created.number}`);
  });
}

export type PlanState = { error?: string; plan?: Plan } | null;

/** "Plan first": the AI's plan for the request, shown for approval. Builds nothing. */
export async function planAction(form: FormData): Promise<PlanState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  try {
    const baseNumber = Number(text(form, "base"));
    const base = await withTenant(session.tenant.id, (tx) => getVersionByNumber(tx, siteId, baseNumber));
    const { prompt, attachments } = await requestFrom(form);
    const r = await planVersion(session.tenant.id, { siteId, baseVersionId: base.id, prompt, userId: session.user.id, attachments });
    return { plan: r.plan };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    if (e instanceof NotFound) return { error: "That no longer exists." };
    throw e;
  }
}

export async function renameAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const name = text(form, "name");
    if (!name) throw new UserError("Give the site a name.");
    await withTenant(session.tenant.id, async (tx) => {
      await renameSite(tx, siteId, name);
      const kind = text(form, "kind");
      if (kind) await setSiteKind(tx, siteId, kind);
      // A store always has accounts (its checkout offers them); the box is disabled there and posts nothing.
      if (kind && kind !== "store") await setSiteAccounts(tx, siteId, form.get("accounts") === "1");
    });
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

export async function inventoryAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const [mode, source] = text(form, "inventory").split(":");
    await withTenant(session.tenant.id, async (tx) => {
      await setInventory(tx, siteId, mode ?? "", source ?? null);
      const outOfStock = text(form, "outOfStock");
      if (outOfStock) await setOutOfStock(tx, siteId, outOfStock);
    });
    revalidatePath("/", "layout");
    return { ok: "Saved." };
  });
}

export async function brandAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const logo = await logoFrom(form, session.tenant.id, session.user.id, siteId);
    const brand = brandFromForm(form, logo);
    const r = await withTenant(session.tenant.id, (tx) => saveBrand(tx, siteId, brand, session.user.id));
    revalidatePath(`/sites/${siteId}`, "layout");
    return {
      ok: r.version
        ? `Saved. Version ${r.version.number} applies the brand kit — preview and publish it from Versions.`
        : "Saved. The site already matches it.",
    };
  });
}

export async function addDomainAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const d = await addDomain(session.tenant.id, siteId, text(form, "hostname"), session.user.id, {
      platformAdmin: await isPlatformAdmin(session.user.id),
    });
    revalidatePath(`/sites/${siteId}/settings`);
    return { ok: `${d.hostname} added. The DNS records to add appear below in a few seconds.` };
  });
}

export async function removeDomainAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    await removeDomain(session.tenant.id, text(form, "domainId"));
    revalidatePath(`/sites/${siteId}/settings`);
    return { ok: "Removed." };
  });
}

export async function checkDomainAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    await checkDomainNow(session.tenant.id, text(form, "domainId"));
    revalidatePath(`/sites/${siteId}/settings`);
    return { ok: "Checking now — refresh in a few seconds." };
  });
}

export async function connectGitAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const link = await connectGit(session.tenant.id, siteId, { repo: text(form, "repo"), token: text(form, "token") }, session.user.id);
    revalidatePath(`/sites/${siteId}/settings`);
    return { ok: `Connected to ${link.owner}/${link.repo}. The newest version is being pushed now.` };
  });
}

export async function disconnectGitAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    await disconnectGit(session.tenant.id, siteId);
    revalidatePath(`/sites/${siteId}/settings`);
    return { ok: "Disconnected. The repository keeps everything already pushed." };
  });
}

export async function importBranchAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const v = await importFromBranch(session.tenant.id, siteId, text(form, "branch"), session.user.id);
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${v.number}`);
  });
}

export async function importRevisionAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const [file] = await filesOf(form, "archive");
    if (!file) throw new UserError("Choose the zip file to import.");
    const v = await importRevision(session.tenant.id, siteId, file.bytes, session.user.id);
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${v.number}`);
  });
}

export async function importSiteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const [file] = await filesOf(form, "archive");
    if (!file) throw new UserError("Choose the exported site (.zip) to import.");
    const site = await importSite(session.tenant.id, {
      name: text(form, "name"),
      subdomain: text(form, "subdomain"),
      bytes: file.bytes,
      userId: session.user.id,
    });
    revalidatePath("/", "layout");
    redirect(`/sites/${site.id}/versions`);
  });
}

export async function deleteSiteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    if (session.role === "editor") throw new UserError("Only an owner or admin can delete a site.");
    await deleteSite(session.tenant.id, siteId, text(form, "confirm"));
    revalidatePath("/", "layout");
    redirect("/sites");
  });
}

export async function applyProposalsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const siteId = text(form, "siteId");
  return attempt(async () => {
    const indices = form.getAll("proposal").map((v) => Number(v)).filter((n) => Number.isInteger(n));
    const v = await applyProposals(session.tenant.id, siteId, Number(text(form, "number")), indices, session.user.id);
    revalidatePath(`/sites/${siteId}`, "layout");
    redirect(`/sites/${siteId}/versions/${v.number}`);
  });
}
