import type { ReactNode } from "react";
import { ComplianceTabs } from "@/components/compliance/compliance-tabs";
import { requirePermission } from "@/lib/auth/current-user";

export default async function ComplianceLayout({ children }: { children: ReactNode }) {
  await requirePermission("compliance.manage", "/admin/compliance");
  return (
    <>
      <ComplianceTabs />
      {children}
    </>
  );
}
