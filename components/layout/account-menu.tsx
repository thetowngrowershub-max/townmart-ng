"use client";

import { ChevronDown, LogOut, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOutAction } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

export type AccountMenuLink = { href: string; label: string };

/**
 * The signed-in user's menu in the site header. One button holds the account,
 * dashboard, admin and sign-out links, so the header row never grows wider
 * than a small phone however many roles the user has.
 */
export function AccountMenu({ name, email, links }: { name: string; email: string; links: AccountMenuLink[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  // Close on navigation, outside click and Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const firstName = name.split(/\s+/)[0] || "Account";
  const itemClass = "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none";

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        <User className="size-5" aria-hidden />
        <span className="hidden max-w-28 truncate lg:inline">{firstName}</span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      <div id={menuId} hidden={!open} className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border bg-card p-2 text-card-foreground shadow-lg">
        <div className="border-b px-3 pb-2 pt-1">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{email}</p>
        </div>
        <nav aria-label="Account" className="py-1">
          <ul>
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={cn(itemClass, pathname === l.href && "font-semibold text-primary")} aria-current={pathname === l.href ? "page" : undefined}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <form action={signOutAction} className="border-t pt-1">
          <button type="submit" className={itemClass}>
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
