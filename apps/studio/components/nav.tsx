"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName, cx } from "./ui";

type Item = { href: string; label: string; icon: IconName; exact?: boolean; when?: "commerce" | "admin" };

const ITEMS: Item[] = [
  { href: "/", label: "Overview", icon: "home", exact: true },
  { href: "/sites", label: "Sites", icon: "globe" },
  { href: "/media", label: "Media", icon: "image" },
  { href: "/integrations", label: "Integrations", icon: "plug" },
  // Only a business with a store has anything to sell or deliver.
  { href: "/products", label: "Products", icon: "box", when: "commerce" },
  { href: "/orders", label: "Orders", icon: "cart", when: "commerce" },
  { href: "/usage", label: "AI usage", icon: "sparkles" },
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/admin", label: "Platform admin", icon: "shield", when: "admin" },
];

export function SidebarNav({ commerce = false, admin = false }: { commerce?: boolean; admin?: boolean }) {
  const path = usePathname();
  const items = ITEMS.filter((i) => !i.when || (i.when === "commerce" ? commerce : admin));
  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col" aria-label="Main">
      {items.map((item) => {
        const active = item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cx(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors",
              active ? "bg-white text-slate-900 shadow-xs ring-1 ring-slate-200" : "text-slate-600 hover:bg-white/70 hover:text-slate-900",
            )}
          >
            <Icon name={item.icon} className={active ? "text-brand-600" : "text-slate-400"} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Tabs({ tabs }: { tabs: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <div className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => {
        const active = t.exact ? path === t.href : path === t.href || path.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cx(
              "-mb-px border-b-2 px-3 py-2.5 text-sm font-medium whitespace-nowrap",
              active ? "border-brand-600 text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
