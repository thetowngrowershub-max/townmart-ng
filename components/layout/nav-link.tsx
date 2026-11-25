"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Highlights itself when it points at the current page. */
export function NavLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(className, active ? "bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
    >
      {children}
    </Link>
  );
}
