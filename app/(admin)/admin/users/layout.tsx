import type { ReactNode } from "react";
import { SectionTabs } from "@/components/admin/section-tabs";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";

export default async function UsersLayout({ children }: { children: ReactNode }) {
  const user = await requirePermission("user.manage", "/admin/users");
  const tabs = [{ href: "/admin/users", label: "Accounts" }, ...(can(user, "audit_log.read") ? [{ href: "/admin/users/audit", label: "Audit log" }] : [])];
  return (
    <>
      <SectionTabs label="Users and roles" tabs={tabs} />
      {children}
    </>
  );
}
