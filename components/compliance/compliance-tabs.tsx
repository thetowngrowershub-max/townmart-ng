"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/compliance", label: "Overview" },
  { href: "/admin/compliance/requests", label: "Data requests" },
  { href: "/admin/compliance/breaches", label: "Breaches" },
  { href: "/admin/compliance/records", label: "RoPA & DPIAs" },
  { href: "/admin/compliance/retention", label: "Retention" },
  { href: "/admin/compliance/legal", label: "Legal pages" },
  { href: "/admin/compliance/logs", label: "Consent & access logs" },
];

export function ComplianceTabs() {
  const path = usePathname();
  return (
    <nav aria-label="Compliance centre" className="-mx-4 mb-6 overflow-x-auto px-4">
      <ul className="flex w-max gap-1 border-b">
        {TABS.map((t) => {
          const active = t.href === "/admin/compliance" ? path === t.href : path.startsWith(t.href);
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
