"use server";

import {
  UserError,
  changeCustomerPassword,
  commerceSafeBack,
  createCustomerSession,
  endCustomerSession,
  signInCustomer,
  signUpCustomer,
  updateCustomerProfile,
} from "@zsite/platform";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { CUSTOMER_COOKIE, currentCustomer, customerToken, setCustomerCookie } from "@/lib/shop";
import { currentSite } from "@/lib/site";

export type AccountState = { error?: string; ok?: string } | null;

const text = (form: FormData, k: string) => String(form.get(k) ?? "").trim();

async function guard(fn: () => Promise<AccountState | void>): Promise<AccountState> {
  try {
    return (await fn()) ?? null;
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function signInAction(_: AccountState, form: FormData): Promise<AccountState> {
  const current = await currentSite();
  if (!current) return { error: "This store is not available." };
  return guard(async () => {
    const { customerId } = await signInCustomer(current.resolved.tenantId, text(form, "email"), String(form.get("password") ?? ""));
    const s = await createCustomerSession(current.resolved.tenantId, customerId);
    await setCustomerCookie(s.token, s.expires);
    redirect(commerceSafeBack(text(form, "next") || "/account"));
  });
}

export async function signUpAction(_: AccountState, form: FormData): Promise<AccountState> {
  const current = await currentSite();
  if (!current) return { error: "This store is not available." };
  return guard(async () => {
    const { customerId } = await signUpCustomer(current.resolved.tenantId, {
      name: text(form, "name"),
      email: text(form, "email"),
      phone: text(form, "phone"),
      password: String(form.get("password") ?? ""),
      siteId: current.resolved.siteId,
    });
    const s = await createCustomerSession(current.resolved.tenantId, customerId);
    await setCustomerCookie(s.token, s.expires);
    redirect(commerceSafeBack(text(form, "next") || "/account"));
  });
}

export async function signOutAction(): Promise<void> {
  const current = await currentSite();
  const token = await customerToken();
  if (current && token) await endCustomerSession(current.resolved.tenantId, token);
  (await cookies()).delete(CUSTOMER_COOKIE);
  redirect("/account");
}

export async function profileAction(_: AccountState, form: FormData): Promise<AccountState> {
  const current = await currentSite();
  const customer = current ? await currentCustomer(current) : null;
  if (!current || !customer) return { error: "Please sign in again." };
  return guard(async () => {
    await updateCustomerProfile(current.resolved.tenantId, customer.id, {
      name: text(form, "name"),
      phone: text(form, "phone"),
      address: text(form, "address"),
    });
    return { ok: "Saved." };
  });
}

export async function passwordAction(_: AccountState, form: FormData): Promise<AccountState> {
  const current = await currentSite();
  const customer = current ? await currentCustomer(current) : null;
  if (!current || !customer) return { error: "Please sign in again." };
  return guard(async () => {
    await changeCustomerPassword(current.resolved.tenantId, customer.id, String(form.get("current") ?? ""), String(form.get("password") ?? ""));
    // Changing the password signs out every session, this one included; start a fresh one.
    const s = await createCustomerSession(current.resolved.tenantId, customer.id);
    await setCustomerCookie(s.token, s.expires);
    return { ok: "Password changed. You have been signed out everywhere else." };
  });
}
