import type { Metadata } from "next";
import Link from "next/link";
import { TwoFactorForm } from "@/components/auth/two-factor-form";
import { Alert } from "@/components/ui/alert";
import { readPendingTwoFactor } from "@/lib/auth/two-factor";
import { decryptNullable } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { maskPhone } from "@/lib/phone";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Enter your code", robots: { index: false } };

export default async function TwoFactorPage() {
  const pending = await readPendingTwoFactor();
  const user = pending ? await prisma.user.findUnique({ where: { id: pending.userId }, select: { phoneEncrypted: true } }) : null;
  const phone = decryptNullable(user?.phoneEncrypted);
  return (
    <AuthCard title="Enter your code" description={phone ? `We've sent a 6-digit code to ${maskPhone(phone)}.` : "Two-step sign-in"}>
      {pending && phone ? (
        <TwoFactorForm />
      ) : (
        <Alert variant="warning">
          Your sign-in timed out. <Link href="/auth/sign-in">Sign in again</Link>
        </Alert>
      )}
    </AuthCard>
  );
}
