import Link from "next/link";
import { SidebarNav } from "@/components/nav";
import { Icon } from "@/components/ui";
import { requireSession } from "@/lib/session";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="md:flex">
      <aside className="border-b border-slate-200 bg-slate-50 md:sticky md:top-0 md:flex md:h-screen md:w-60 md:shrink-0 md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <Link href="/" className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">Z</Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{session.tenant.name}</p>
            <p className="text-xs text-slate-500">Zuuvy Sites</p>
          </div>
        </div>
        <div className="px-3 pb-3 md:flex-1">
          <SidebarNav />
        </div>
        <div className="hidden border-t border-slate-200 px-4 py-3 md:block">
          <p className="truncate text-sm font-medium text-slate-800">{session.user.name}</p>
          <p className="truncate text-xs text-slate-500">{session.user.email}</p>
          <form action="/logout" method="post" className="mt-2">
            <button className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800">
              <Icon name="logout" className="h-3.5 w-3.5" /> Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
