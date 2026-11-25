import { Bell } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { withRls } from "@/lib/db";
import { AccountMenu, type AccountMenuLink } from "./account-menu";

/** The right-hand side of the site header. `cart` is the cart button, placed after any shortcuts. */
export async function UserMenu({ cart }: { cart: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-1 sm:gap-2">
        {cart}
        <Button asChild variant="ghost" size="sm" className="px-2 sm:px-3">
          <Link href="/auth/sign-in">Sign in</Link>
        </Button>
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/auth/sign-up">Create account</Link>
        </Button>
      </div>
    );
  }
  // Order updates, booking changes and messages land here (Phase 4).
  const unread = await withRls({ userId: user.id }, (tx) => tx.notification.count({ where: { userId: user.id, readAt: null } })).catch(() => 0);
  const isSeller = can(user, "dashboard.access");
  const isAdmin = can(user, "admin.access");
  const links: AccountMenuLink[] = [
    { href: "/account", label: "My account" },
    { href: "/account/orders", label: "My orders" },
    { href: "/account/bookings", label: "My bookings" },
    ...(isSeller ? [{ href: "/dashboard", label: "Seller dashboard" }] : []),
    ...(isAdmin ? [{ href: "/admin", label: "Admin console" }] : []),
    { href: "/account/security", label: "Profile & security" },
  ];
  return (
    <div className="flex items-center gap-0.5 sm:gap-1">
      {/* Shortcuts only where there is room; the account menu always has them. */}
      {isAdmin && (
        <Button asChild variant="ghost" size="sm" className={isSeller ? "hidden xl:inline-flex" : "hidden lg:inline-flex"}>
          <Link href="/admin">Admin</Link>
        </Button>
      )}
      {isSeller && (
        <Button asChild variant="ghost" size="sm" className="hidden lg:inline-flex">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      )}
      {cart}
      <Button asChild variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}>
        <Link href="/account/notifications">
          <Bell aria-hidden />
          {unread > 0 && (
            <span aria-hidden className="absolute -top-0.5 -right-0.5 grid min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-danger-foreground">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
      </Button>
      <AccountMenu name={user.name ?? "My account"} email={user.email} links={links} />
    </div>
  );
}
