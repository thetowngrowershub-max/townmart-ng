"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Tabs across the top of an admin section. The first tab is the section's index and matches its path exactly. */
export function SectionTabs({ label, tabs }: { label: string; tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="-mx-4 mb-6 overflow-x-auto px-4">
      <ul className="flex w-max gap-1 border-b">
        {tabs.map((t, i) => {
          const active = i === 0 ? path === t.href : path.startsWith(t.href);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn("block border-b-2 px-3 py-2 text-sm whitespace-nowrap", active ? "border-primary font-semibold text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
