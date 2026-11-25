"use server";

import { redirect } from "next/navigation";
import { completeSignIn } from "@/lib/auth/complete-sign-in";
import { prisma } from "@/lib/db";
import { isTestMode } from "@/lib/platform";
import { requestMeta } from "@/lib/request";
import { DEMO_ACCOUNTS } from "./demo-accounts";

/**
 * Signs in as one of the seeded demo accounts without a password. Test-mode
 * sites only, and only the demo accounts: everyone else still needs a password.
 */
export async function demoSignInAction(formData: FormData): Promise<void> {
  if (!isTestMode()) redirect("/auth/sign-in");
  const email = String(formData.get("email") ?? "");
  const account = DEMO_ACCOUNTS.find((a) => a.email === email);
  if (!account) redirect("/auth/demo?error=unknown");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true } });
  if (!user || user.status !== "active") redirect("/auth/demo?error=unavailable");
  redirect(await completeSignIn(user.id, account.home, await requestMeta()));
}
