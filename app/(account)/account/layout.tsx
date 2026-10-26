import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Forbidden } from "@/components/layout/forbidden";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { requireUser } from "@/lib/auth/current-user";
import { accountNav } from "@/lib/navigation";

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const { allowed } = await requireUser("account.access", "/account");
  return (
    <>
      <SiteHeader />
      {allowed ? (
        <AppShell title="My account" nav={accountNav} navLabel="Account">
          {children}
        </AppShell>
      ) : (
        <Forbidden message="Your account can't access this area." />
      )}
      <SiteFooter />
    </>
  );
}
