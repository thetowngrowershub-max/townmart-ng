import { LogOut, User } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/current-user";
import { signOutAction } from "@/lib/auth/actions";
import { can } from "@/lib/authz";

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
      <Button asChild variant="ghost" size="sm">
        <Link href="/account">
          <User aria-hidden />
          <span className="max-w-32 truncate">{user.name ?? "Account"}</span>
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
