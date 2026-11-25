import type { ReactNode } from "react";
import type { NavItem } from "@/lib/navigation";
import { SideNav } from "./side-nav";

/** Two-column shell shared by the account area, seller dashboard and admin console. */
export function AppShell({
  title,
  nav,
  navLabel,
  children,
}: {
  title: string;
  nav: NavItem[];
  navLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)] gap-6 px-4 py-6 lg:grid-cols-[240px_minmax(0,1fr)] lg:py-10">
      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <p className="mb-3 hidden px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground lg:block">{title}</p>
        <SideNav items={nav} label={navLabel} />
      </aside>
      <main id="main" className="min-w-0">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
