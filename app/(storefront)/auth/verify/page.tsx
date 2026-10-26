import type { Metadata } from "next";
import { VerifyEmailButton } from "@/components/auth/verify-email-button";
import { Alert } from "@/components/ui/alert";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ email?: string; token?: string }> }) {
  const { email, token } = await searchParams;
  return (
    <AuthCard title="Confirm your email">
      {email && token ? (
        <VerifyEmailButton email={email} token={token} />
      ) : (
        <Alert variant="info">Check your inbox for a link to confirm your email address.</Alert>
      )}
    </AuthCard>
  );
}
