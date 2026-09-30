import { listCustomers, withTenant } from "@zsite/platform";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ago, inr } from "@/lib/format";
import { pageScope } from "@/lib/scope";
import { requireSession } from "@/lib/session";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ params }: { params: Promise<{ siteId?: string }> }) {
  const session = await requireSession();
  const { siteId, base } = await pageScope(params);
  const customers = await withTenant(session.tenant.id, (tx) => listCustomers(tx, siteId));
  return (
    <>
      <PageHeader
        title="Customers"
        description="People who made an account on your stores. They sign in with their email to check out faster and follow their orders; guests can still buy without one."
      />
      <Card className="overflow-x-auto">
        {customers.length === 0 ? (
          <EmptyState icon="users" title="No accounts yet" body="Customers can create one from the account link on your store." />
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs text-slate-500">
              <tr>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-3 py-3 font-medium">Phone</th>
                <th className="px-3 py-3 text-right font-medium">Orders</th>
                <th className="px-3 py-3 text-right font-medium">Spent</th>
                <th className="px-3 py-3 font-medium">Last order</th>
                <th className="px-5 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.email}</p>
                  </td>
                  <td className="px-3 py-3 text-slate-600">{c.phone ?? "—"}</td>
                  <td className="px-3 py-3 text-right">{c.orders}</td>
                  <td className="px-3 py-3 text-right font-medium">{inr(c.spent)}</td>
                  <td className="px-3 py-3 text-slate-600">{c.last_order_at ? ago(c.last_order_at) : "—"}</td>
                  <td className="px-5 py-3 text-slate-600">{ago(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
