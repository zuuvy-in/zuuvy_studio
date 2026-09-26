"use server";

import { UserError, placeOrder } from "@zsite/platform";
import { redirect, unstable_rethrow } from "next/navigation";
import { currentSite } from "@/lib/site";

export type OrderState = { error?: string } | null;

export async function placeOrderAction(_: OrderState, form: FormData): Promise<OrderState> {
  const current = await currentSite();
  if (!current) return { error: "This store is not available." };
  const text = (k: string) => String(form.get(k) ?? "");
  try {
    const placed = await placeOrder(current.resolved.tenantId, {
      siteId: current.site.site.id,
      lines: [{ productId: text("productId"), quantity: Number(text("quantity")) || 1 }],
      customer: { name: text("name"), phone: text("phone"), address: text("address") },
      note: text("note"),
    });
    redirect(`/order/${placed.publicToken}`);
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
