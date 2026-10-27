import { randomToken, sha256 } from "@/lib/crypto";
import { prisma } from "@/lib/db";

/** Replaces any outstanding token of this kind and returns the raw token for the email link. */
export async function issueToken(identifier: string, ttlMs: number): Promise<string> {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.verificationToken.deleteMany({ where: { identifier } }),
    prisma.verificationToken.create({
      data: { identifier, token: sha256(token), expires: new Date(Date.now() + ttlMs) },
    }),
  ]);
  return token;
}

/** Deletes and returns true if a matching, unexpired token exists (single use). */
export async function consumeToken(identifier: string, token: string): Promise<boolean> {
  const { count } = await prisma.verificationToken.deleteMany({
    where: { identifier, token: sha256(token), expires: { gt: new Date() } },
  });
  return count === 1;
}

