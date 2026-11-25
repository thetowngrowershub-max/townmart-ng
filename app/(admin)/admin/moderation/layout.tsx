import type { ReactNode } from "react";
import { SectionTabs } from "@/components/admin/section-tabs";
import { requirePermission } from "@/lib/auth/current-user";

const TABS = [
  { href: "/admin/moderation", label: "Reported listings" },
  { href: "/admin/moderation/taken-down", label: "Taken down" },
  { href: "/admin/moderation/reviews", label: "Reviews" },
  { href: "/admin/moderation/questions", label: "Questions" },
  { href: "/admin/moderation/keywords", label: "Prohibited items" },
];

export default async function ModerationLayout({ children }: { children: ReactNode }) {
  await requirePermission("moderation.manage", "/admin/moderation");
  return (
    <>
      <SectionTabs label="Moderation" tabs={TABS} />
      {children}
    </>
  );
}
