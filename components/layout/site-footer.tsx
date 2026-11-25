import Link from "next/link";
import { CookieSettingsButton } from "@/components/consent/cookie-settings-button";
import { footerLinks } from "@/lib/navigation";
import { Logo } from "./logo";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t bg-card">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-5">
        <div className="flex flex-col gap-3">
          <Logo />
          <p className="text-sm text-muted-foreground">Everything your town sells, in one place.</p>
        </div>
        {footerLinks.map((group) => (
          <nav key={group.heading} aria-label={group.heading}>
            <h2 className="mb-3 text-sm font-semibold">{group.heading}</h2>
            <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} TownMart. Prices in Naira (₦). Times shown in West Africa Time.</p>
          <CookieSettingsButton className="font-medium underline-offset-2 hover:text-foreground hover:underline" />
        </div>
      </div>
    </footer>
  );
}
