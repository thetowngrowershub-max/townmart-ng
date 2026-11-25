import "server-only";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { mergeGuestCart } from "@/lib/cart";
import { randomToken } from "@/lib/crypto";
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "./constants";

/** Creates a database session (same table Auth.js uses), sets the cookie and merges any guest cart. */
export async function createUserSession(
  userId: string,
  meta: { ipHash: string; userAgent: string | null },
): Promise<void> {
  const sessionToken = randomToken(32);
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({
    data: { sessionToken, userId, expires, ipHash: meta.ipHash, userAgent: meta.userAgent },
  });
  (await cookies()).set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
  // Anything added to the cart before signing in comes along.
  await mergeGuestCart(userId);
}

export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function destroyCurrentSession(): Promise<void> {
  const token = await currentSessionToken();
  if (token) await prisma.session.deleteMany({ where: { sessionToken: token } });
  (await cookies()).delete(SESSION_COOKIE);
}
