"use server";

import { type ProductInput, createProduct, updateProduct, uploadAsset, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (text(f, k) === "" ? null : Number(text(f, k)));

async function input(form: FormData, tenantId: string, userId: string): Promise<ProductInput> {
  const images = text(form, "images").split(/\s+/).filter(Boolean);
  const file = form.get("photo");
  if (file && typeof file !== "string" && file.size > 0) {
    const asset = await uploadAsset(tenantId, { bytes: new Uint8Array(await file.arrayBuffer()), alt: text(form, "name"), userId });
    images.unshift(asset.url);
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
