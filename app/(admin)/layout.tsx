import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Forbidden } from "@/components/layout/forbidden";
import { SiteHeader } from "@/components/layout/site-header";
import { requireUser } from "@/lib/auth/current-user";
import { adminNav } from "@/lib/navigation";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · TownMart Admin" }, robots: { index: false } };

/** Wraps /admin/* and /design-system: TownMart staff only. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { allowed } = await requireUser("admin.access", "/admin");
  return (
    <>
      <SiteHeader />
      {allowed ? (
        <AppShell title="TownMart Admin" nav={adminNav} navLabel="Admin">
          {children}
        </AppShell>
      ) : (
        <Forbidden message="The admin console is for TownMart staff only." />
      )}
    </>
  );
}
