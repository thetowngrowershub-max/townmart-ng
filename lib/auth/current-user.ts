import "server-only";
import type { Role } from "@prisma/client";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { can, type Permission } from "@/lib/authz";
import { withRls } from "@/lib/db";
import { auth } from "./config";

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  emailVerified: Date | null;
  roles: Role[];
};

/** The signed-in, active user with their roles, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const user = await withRls({ userId: id }, (tx) =>
    tx.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, emailVerified: true, status: true, roles: { select: { role: true } } },
    }),
  );
  if (!user || user.status !== "active") return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    roles: user.roles.map((r) => r.role),
  };
});

/**
 * For layouts and pages: redirects to sign-in when signed out. Returns the user
 * and whether they hold `permission`, so the caller can render a 403 view.
 */
export async function requireUser(
  permission: Permission & `${string}.access` | "design_system.view" | "system_health.view",
  nextPath: string,
): Promise<{ user: CurrentUser; allowed: boolean }> {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/sign-in?next=${encodeURIComponent(nextPath)}`);
  return { user, allowed: can(user, permission) };
}

/**
 * For pages and Server Actions. Layout checks alone aren't enough in the App
 * Router (a page can be requested without its layout re-running), so every page
 * calls this too. Redirects when signed out; responds 403 (app/forbidden.tsx) otherwise.
 */
export async function requirePermission(
  permission: Parameters<typeof requireUser>[0],
  nextPath: string,
): Promise<CurrentUser> {
  const { user, allowed } = await requireUser(permission, nextPath);
  if (!allowed) forbidden();
  return user;
}
