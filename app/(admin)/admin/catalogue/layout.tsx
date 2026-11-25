import type { ReactNode } from "react";
import { SectionTabs } from "@/components/admin/section-tabs";
import { requirePermission } from "@/lib/auth/current-user";

const TABS = [
  { href: "/admin/catalogue", label: "Categories" },
  { href: "/admin/catalogue/attributes", label: "Attributes" },
  { href: "/admin/catalogue/commission", label: "Commission" },
  { href: "/admin/catalogue/delivery", label: "Delivery zones" },
  { href: "/admin/catalogue/promotions", label: "Platform promotions" },
  { href: "/admin/catalogue/settings", label: "Platform settings" },
];

export default async function CatalogueLayout({ children }: { children: ReactNode }) {
  await requirePermission("admin.access", "/admin/catalogue");
  return (
    <>
      <SectionTabs label="Catalogue and fees" tabs={TABS} />
      {children}
    </>
  );
}
