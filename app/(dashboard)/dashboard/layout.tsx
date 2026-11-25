import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Forbidden } from "@/components/layout/forbidden";
import { SiteHeader } from "@/components/layout/site-header";
import { requireUser } from "@/lib/auth/current-user";
import { dashboardNav } from "@/lib/navigation";

export const metadata: Metadata = { title: { default: "Seller dashboard", template: "%s · Seller dashboard" }, robots: { index: false } };

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { allowed } = await requireUser("dashboard.access", "/dashboard");
  return (
    <>
      <SiteHeader />
      {allowed ? (
        <AppShell title="Seller dashboard" nav={dashboardNav} navLabel="Seller dashboard">
          {children}
        </AppShell>
      ) : (
        <Forbidden
          message="The seller dashboard is for merchants, service providers and their staff."
          cta={{ href: "/sell", label: "Become a seller" }}
        />
      )}
    </>
  );
}
