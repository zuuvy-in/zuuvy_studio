"use server";

import {
  UserError,
  addToGroup,
  createGroup,
  deleteGroup,
  generateVariants,
  getGroup,
  parseOptions,
  removeFromGroup,
  setVariants,
  updateGroup,
  uploadAsset,
  withTenant,
} from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { formScope, ownSiteId } from "@/lib/scope";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (text(f, k) === "" ? null : Number(text(f, k)));

async function groupInput(form: FormData, tenantId: string, userId: string) {
  const images = text(form, "images").split(/\s+/).filter(Boolean);
  for (const file of form.getAll("photos")) {
    if (typeof file === "string" || file.size === 0) continue;
    const asset = await uploadAsset(tenantId, { bytes: new Uint8Array(await file.arrayBuffer()), alt: text(form, "name"), userId });
    images.push(asset.url);
  }
  return {
    name: text(form, "name"),
    description: text(form, "description"),
    category: text(form, "category") || null,
    images,
    options: parseOptions(text(form, "options")),
    active: form.get("active") !== null ? form.get("active") === "1" : true,
  };
}

export async function createGroupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const input = await groupInput(form, session.tenant.id, session.user.id);
    const group = await withTenant(session.tenant.id, async (tx) => {
      const g = await createGroup(tx, { ...input, siteId: await ownSiteId(tx, scope) });
      const price = num(form, "price");
      if (price !== null && g.options.length) await generateVariants(tx, g.id, { price, stock: num(form, "stock") });
      return g;
    });
    revalidatePath(`${scope.base}/products`);
    redirect(`${scope.base}/products/groups/${group.id}`);
  });
}

export async function updateGroupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = text(form, "id");
    const input = await groupInput(form, session.tenant.id, session.user.id);
    await withTenant(session.tenant.id, (tx) => updateGroup(tx, id, input));
    revalidatePath(`${scope.base}/products/groups/${id}`);
    return { ok: "Saved." };
  });
}

export async function generateAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = text(form, "id");
    const price = num(form, "price");
    if (price === null) throw new UserError("Give the new variants a price.");
    const r = await withTenant(session.tenant.id, (tx) => generateVariants(tx, id, { price, mrp: num(form, "mrp"), stock: num(form, "stock") }));
    revalidatePath(`${scope.base}/products/groups/${id}`);
    return { ok: r.created ? `${r.created} variants added.` : "Every combination already has a product." };
  });
}

/** The variants table: which combination each product is, and its price and stock. */
export async function saveVariantsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = text(form, "id");
    await withTenant(session.tenant.id, async (tx) => {
      const group = await getGroup(tx, id);
      const rows = group.variants.map((v) => ({
        productId: v.id,
        options: Object.fromEntries(group.options.map((o) => [o.name, text(form, `opt:${v.id}:${o.name}`)])),
        ...(v.source === "native" ? { price: num(form, `price:${v.id}`), stock: num(form, `stock:${v.id}`) } : {}),
      }));
      await setVariants(tx, id, rows);
      const remove = form.getAll("remove").map(String);
      if (remove.length) await removeFromGroup(tx, remove);
    });
    revalidatePath(`${scope.base}/products/groups/${id}`);
    revalidatePath(`${scope.base}/products`);
    return { ok: "Variants saved." };
  });
}

export async function addProductsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = text(form, "id");
    const n = await withTenant(session.tenant.id, (tx) => addToGroup(tx, id, form.getAll("ids").map(String)));
    revalidatePath(`${scope.base}/products/groups/${id}`);
    return { ok: `${n} added. Set which combination each one is below.` };
  });
}

export async function deleteGroupAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    await withTenant(session.tenant.id, (tx) => deleteGroup(tx, text(form, "id")));
    revalidatePath(`${scope.base}/products`);
    redirect(`${scope.base}/products/groups`);
  });
}
