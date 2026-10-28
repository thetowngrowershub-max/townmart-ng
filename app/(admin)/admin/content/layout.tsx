import type { ReactNode } from "react";
import { SectionTabs } from "@/components/admin/section-tabs";
import { requirePermission } from "@/lib/auth/current-user";

const TABS = [
  { href: "/admin/content", label: "Homepage banners" },
  { href: "/admin/content/featured", label: "Featured stores" },
  { href: "/admin/content/help", label: "Help centre" },
  { href: "/admin/content/pages", label: "About and contact" },
];

export default async function ContentLayout({ children }: { children: ReactNode }) {
  await requirePermission("content.manage", "/admin/content");
  return (
    <>
      <SectionTabs label="Content" tabs={TABS} />
      {children}
    </>
  );
}
