import { PrismaAdapter } from "@auth/prisma-adapter";
import type { User as DbUser } from "@prisma/client";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, SESSION_UPDATE_AGE_SECONDS } from "./constants";

export const googleEnabled = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);

const config: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  // Database sessions (not long-lived JWTs) so any session can be revoked.
  session: { strategy: "database", maxAge: SESSION_MAX_AGE_SECONDS, updateAge: SESSION_UPDATE_AGE_SECONDS },
  // Email + password sign-in is handled by our own Server Action (lib/auth/actions.ts),
  // which writes to the same `sessions` table and cookie, because Auth.js's
  // Credentials provider only supports JWT sessions.
  providers: googleEnabled ? [Google] : [],
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE,
      options: { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" },
    },
  },
  pages: { signIn: "/auth/sign-in", error: "/auth/sign-in", verifyRequest: "/auth/verify" },
  callbacks: {
    signIn({ user }) {
      const status = (user as Partial<DbUser>).status;
      // Signing in during the deletion grace period cancels the deletion (events.signIn).
      return status === undefined || status === "active" || status === "pending_deletion";
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    async createUser({ user }) {
      // OAuth sign-ups become customers, like password sign-ups.
      if (!user.id) return;
      const userId = user.id;
      const { recordAcceptances } = await import("@/lib/legal/documents");
      await withRls({ userId }, async (tx) => {
        await tx.userRole.create({ data: { userId, role: "customer" } });
        // The Google button says that continuing accepts the Terms and Privacy Policy.
        await recordAcceptances(tx, { context: "sign_up", userId });
      });
    },
    async signIn({ user }) {
      if (!user.id) return;
      const { restoreAccount } = await import("@/lib/privacy/account");
      await withSystemContext((tx) => restoreAccount(tx, user.id!));
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      // Google sign-in: bring the guest cart along (imported lazily to avoid a cycle with lib/cart).
      const { mergeGuestCart } = await import("@/lib/cart");
      await mergeGuestCart(user.id);
    },
  },
  logger: {
    error: (error) => logger.error({ err: error }, "auth.js error"),
    warn: (code) => logger.warn({ code }, "auth.js warning"),
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
