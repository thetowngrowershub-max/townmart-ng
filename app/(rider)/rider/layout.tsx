import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Forbidden } from "@/components/layout/forbidden";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { requireUser } from "@/lib/auth/current-user";
import { riderNav } from "@/lib/navigation";

/** The TownMart rider area: anyone signed in can apply; approved riders see jobs here. */
export default async function RiderLayout({ children }: { children: ReactNode }) {
  const { allowed } = await requireUser("account.access", "/rider");
  return (
    <>
      <SiteHeader />
      {allowed ? (
        <AppShell title="TownMart rider" nav={riderNav} navLabel="Rider">
          {children}
        </AppShell>
      ) : (
        <Forbidden message="Your account can't access this area." />
      )}
      <SiteFooter />
    </>
  );
}
