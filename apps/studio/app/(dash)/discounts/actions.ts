"use server";

import { type DiscountInput, createDiscount, deleteDiscount, updateDiscount, withTenant } from "@zsite/platform";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, attempt } from "@/lib/actions";
import { formScope, ownSiteId } from "@/lib/scope";
import { requireSession } from "@/lib/session";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (f: FormData, k: string) => (text(f, k) === "" ? null : Number(text(f, k)));

function input(form: FormData): DiscountInput {
  const scope = text(form, "scope") || "all";
  const scopeIds =
    scope === "categories"
      ? text(form, "categories").split(",").map((c) => c.trim()).filter(Boolean)
      : form.getAll(scope === "groups" ? "groupIds" : "productIds").map(String);
  return {
    name: text(form, "name"),
    code: text(form, "code") || null,
    kind: text(form, "kind"),
    value: Number(text(form, "value")),
    scope,
    scopeIds,
    minSubtotal: num(form, "minSubtotal"),
    minQuantity: num(form, "minQuantity"),
    maxAmount: num(form, "maxAmount"),
    startsAt: text(form, "startsAt") || null,
    endsAt: text(form, "endsAt") || null,
    usageLimit: num(form, "usageLimit"),
    oncePerCustomer: form.get("oncePerCustomer") === "1",
    firstOrderOnly: form.get("firstOrderOnly") === "1",
    stacks: form.get("stacks") === "1",
    active: form.get("active") === "1",
  };
}

export async function saveDiscountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    const id = text(form, "id");
    await withTenant(session.tenant.id, async (tx) => (id ? updateDiscount(tx, id, input(form)) : createDiscount(tx, { ...input(form), siteId: await ownSiteId(tx, scope) })));
    revalidatePath(`${scope.base}/discounts`);
    redirect(`${scope.base}/discounts`);
  });
}

export async function deleteDiscountAction(_: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession();
  const scope = formScope(form);
  return attempt(async () => {
    await withTenant(session.tenant.id, (tx) => deleteDiscount(tx, text(form, "id")));
    revalidatePath(`${scope.base}/discounts`);
    redirect(`${scope.base}/discounts`);
  });
}
