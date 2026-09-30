import { Tabs } from "@/components/nav";

export function AdminTabs() {
  return (
    <Tabs
      tabs={[
        { href: "/admin", label: "People & usage", exact: true },
        { href: "/admin/admins", label: "Admins" },
        { href: "/admin/templates", label: "Premade sites" },
      ]}
    />
  );
}
