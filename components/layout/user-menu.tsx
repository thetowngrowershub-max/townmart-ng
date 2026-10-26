import { Bell, LogOut, User } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import { can } from "@/lib/authz";
import { withRls } from "@/lib/db";

export async function UserMenu() {
  const user = await getCurrentUser();
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
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
  return (
    <div className="flex items-center gap-1">
      {can(user, "admin.access") && (
        <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
          <Link href="/admin">Admin</Link>
        </Button>
      )}
      {can(user, "dashboard.access") && (
        <Button asChild variant="ghost" size="sm" className="hidden md:inline-flex">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      )}
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
      <Button asChild variant="ghost" size="sm">
        <Link href="/account">
          <User aria-hidden />
          <span className="hidden max-w-32 truncate sm:inline">{user.name ?? "Account"}</span>
          <span className="sr-only sm:hidden">Account</span>
        </Link>
      </Button>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out">
          <LogOut aria-hidden />
        </Button>
      </form>
    </div>
  );
}
