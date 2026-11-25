import "server-only";
import { prisma, withSystemContext } from "@/lib/db";
import { restoreAccount } from "@/lib/privacy/account";
import { createUserSession } from "./session";

/**
 * The last step of a password sign-in (after the code, when two-step sign-in
 * is on): cancels a pending deletion, starts the session and says where to go.
 * Deliberately not a Server Action: it starts a session for whatever user id
 * it is given, so only code that has already checked the password calls it.
 */
export async function completeSignIn(userId: string, next: string | null, meta: { ipHash: string; userAgent: string | null }): Promise<string> {
  // Signing in during the deletion grace period cancels the deletion.
  const restored = await withSystemContext((tx) => restoreAccount(tx, userId, meta.ipHash));
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await createUserSession(userId, meta);
  return restored ? "/account/privacy?restored=1" : (next ?? "/account");
}
