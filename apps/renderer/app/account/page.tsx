import { commerceSafeBack, customerOrders } from "@zsite/platform";
import { SiteShell } from "@zsite/runtime";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SHORT_STATUS } from "@/app/order/view";
import { chromeContext, currentCustomer, isStore } from "@/lib/shop";
import { currentSite } from "@/lib/site";
import { signOutAction } from "./actions";
import { PasswordForm, ProfileForm, SignInForm, SignUpForm } from "./forms";

export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const current = await currentSite();
  if (!current || !isStore(current)) notFound();
  const next = commerceSafeBack((await searchParams).next ?? "/account");
  const [customer, ctx] = await Promise.all([currentCustomer(current), chromeContext(current)]);

  if (!customer) {
    return (
      <SiteShell tree={current.site.tree} ctx={ctx}>
        <div className="zs-container zs-page">
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)" }}>Your account</h1>
          <p className="zs-lede">Sign in to check out faster and follow your orders.</p>
          <div className="zs-account" style={{ marginTop: 24 }}>
            <section className="zs-card">
              <h2 style={{ fontSize: "1.2rem" }}>Sign in</h2>
              <SignInForm next={next} />
            </section>
            <section className="zs-card">
              <h2 style={{ fontSize: "1.2rem" }}>New here? Create an account</h2>
              <SignUpForm next={next} />
            </section>
          </div>
        </div>
      </SiteShell>
    );
  }

  const orders = await customerOrders(current.resolved.tenantId, customer.id);
  return (
    <SiteShell tree={current.site.tree} ctx={ctx}>
      <div className="zs-container zs-page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontSize: "clamp(1.8rem, 4vw, 2.4rem)", margin: 0 }}>Hi, {customer.name.split(" ")[0]}</h1>
          <form action={signOutAction}>
            <button type="submit" className="zs-btn zs-btn-ghost zs-btn-sm">Sign out</button>
          </form>
        </div>
        <section className="zs-card" style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: "1.2rem" }}>Your orders</h2>
          {orders.length === 0 ? (
            <p className="zs-muted">
              No orders yet. <a href="/">Start shopping</a>
            </p>
          ) : (
            <table className="zs-orders">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.number}>
                    <td>
                      <a href={`/account/orders/${o.number}`}>WEB-{o.number}</a>
                    </td>
                    <td>{new Date(o.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</td>
                    <td>{o.items}</td>
                    <td>{inr(o.total)}</td>
                    <td>
                      <span className="zs-status" data-status={o.status}>{SHORT_STATUS[o.status] ?? o.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <div className="zs-account" style={{ marginTop: 24 }}>
          <section className="zs-card">
            <h2 style={{ fontSize: "1.2rem" }}>Your details</h2>
            <p className="zs-muted zs-small">{customer.email}</p>
            <ProfileForm name={customer.name} phone={customer.phone ?? ""} address={customer.address ?? ""} />
          </section>
          <section className="zs-card">
            <h2 style={{ fontSize: "1.2rem" }}>Password</h2>
            <PasswordForm />
          </section>
        </div>
      </div>
    </SiteShell>
  );
}
