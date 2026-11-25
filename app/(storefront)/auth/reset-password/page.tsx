import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Alert } from "@/components/ui/alert";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ email?: string; token?: string }> }) {
  const { email, token } = await searchParams;
  return (
    <AuthCard title="Choose a new password" description="You'll be signed out on all other devices.">
      {email && token ? (
        <ResetPasswordForm email={email} token={token} />
      ) : (
        <Alert variant="danger">
          This reset link is incomplete. <Link href="/auth/forgot-password">Request a new one</Link>.
        </Alert>
      )}
    </AuthCard>
  );
}
