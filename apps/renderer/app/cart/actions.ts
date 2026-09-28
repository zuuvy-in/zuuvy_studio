"use server";

import { UserError, checkout, commerceSafeBack, updateCart } from "@zsite/platform";
import { redirect, unstable_rethrow } from "next/navigation";
import { commerceOf } from "@zsite/runtime";
import { currentCustomer, readCart, readCode, writeCart, writeCode } from "@/lib/shop";
import { currentSite } from "@/lib/site";

const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

/** Add a product. Then: stay where they were (the drawer opens), go to the cart, or straight to checkout. */
export async function addToCartAction(form: FormData): Promise<void> {
  const current = await currentSite();
  if (!current) return;
  const quantity = Math.max(1, Number(text(form, "quantity")) || 1);
  await writeCart(updateCart(await readCart(), text(form, "productId"), quantity, "add"));
  const then = text(form, "then");
  if (then === "checkout") redirect("/checkout");
  const c = commerceOf(current.site.tree);
  if (c.cart.style === "page" || then === "cart") redirect("/cart");
  // Back where they were, with the drawer open. A query flag rather than #cart: the server
  // renders it open, so it works however the page was reached.
  redirect(`${commerceSafeBack(text(form, "back")).split("?")[0]}?cart=open`);
}

export async function setQuantityAction(form: FormData): Promise<void> {
  await writeCart(updateCart(await readCart(), text(form, "productId"), Number(text(form, "quantity")), "set"));
  const back = text(form, "back");
  if (back) redirect(commerceSafeBack(back));
}

export async function applyCodeAction(form: FormData): Promise<void> {
  await writeCode(text(form, "code").toUpperCase() || null);
}

export async function removeCodeAction(): Promise<void> {
  await writeCode(null);
}

export type CheckoutState = { error?: string } | null;

export async function placeOrderAction(_: CheckoutState, form: FormData): Promise<CheckoutState> {
  const current = await currentSite();
  if (!current) return { error: "This store is not available." };
  const customer = await currentCustomer(current);
  try {
    const placed = await checkout(current.resolved, {
      items: await readCart(),
      customer: { name: text(form, "name"), phone: text(form, "phone"), address: text(form, "address") },
      note: text(form, "note"),
      code: await readCode(),
      customerId: customer?.id ?? null,
      field: (name) => text(form, name),
    });
    await writeCart([]);
    await writeCode(null);
    redirect(customer ? `/account/orders/${placed.number}` : `/order/${placed.publicToken}`);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
