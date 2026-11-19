import "server-only";
import { prisma } from "@/lib/db";
import { loadTwoFactorUser, startSecondStep } from "./two-factor-methods";

/**
 * Called from the Auth.js sign-in callback. When the Google login belongs to an
 * account with two-step sign-in on, parks the sign-in in the pending cookie and
 * returns where to send the browser instead of creating a session. Returning a
 * path from the callback makes Auth.js stop without signing in.
 */
export async function googleSecondStep(provider: string, providerAccountId: string): Promise<string | null> {
  const linked = await prisma.account.findUnique({ where: { provider_providerAccountId: { provider, providerAccountId } }, select: { userId: true } });
  if (!linked) return null;
  const user = await loadTwoFactorUser(linked.userId);
  if (!user?.twoFactorEnabledAt) return null;
  const started = await startSecondStep(user, null, "google");
  return started.ok ? "/auth/two-factor" : `/auth/sign-in?error=TwoFactorUnavailable`;
}
