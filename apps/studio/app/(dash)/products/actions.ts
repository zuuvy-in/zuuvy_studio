"use server";

import { type ProductInput, UserError, addToGroup, createGroup, createProduct, updateProduct, uploadAsset, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (text(f, k) === "" ? null : Number(text(f, k)));

async function input(form: FormData, tenantId: string, userId: string): Promise<ProductInput> {
  const images = text(form, "images").split(/\s+/).filter(Boolean);
  // New photos go after the ones already there; the first picture is the main one.
  for (const file of form.getAll("photos")) {
    if (typeof file === "string" || file.size === 0) continue;
    const asset = await uploadAsset(tenantId, { bytes: new Uint8Array(await file.arrayBuffer()), alt: text(form, "name"), userId });
    images.push(asset.url);
  }
  return {
    name: text(form, "name"),
    description: text(form, "description"),
    category: text(form, "category") || null,
    price: num(form, "price"),
    mrp: num(form, "mrp"),
    unitLabel: text(form, "unit") || null,
    stock: num(form, "stock"),
    images,
    active: form.get("active") === "1",
  };
}

export async function saveProductAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const id = text(form, "id");
    const data = await input(form, session.tenant.id, session.user.id);
    await withTenant(session.tenant.id, (tx) => (id ? updateProduct(tx, id, data) : createProduct(tx, data)));
    revalidatePath("/products");
    redirect("/products");
  });
}

/** Put the ticked products into a variant group — an existing one, or a new one named here. */
export async function groupSelectedAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  return attempt(async () => {
    const ids = form.getAll("ids").map(String);
    if (!ids.length) throw new UserError("Tick the products that are variants of one thing.");
    const groupId = await withTenant(session.tenant.id, async (tx) => {
      let id = text(form, "groupId");
      if (!id) {
        const name = text(form, "groupName");
        if (!name) throw new UserError("Choose a group, or name a new one.");
        id = (await createGroup(tx, { name, options: [] })).id;
      }
      await addToGroup(tx, id, ids);
      return id;
    });
    revalidatePath("/products");
    redirect(`/products/groups/${groupId}`);
  });
}
