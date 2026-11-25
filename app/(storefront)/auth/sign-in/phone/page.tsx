import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PhoneSignIn } from "@/components/auth/phone-sign-in";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/validation/auth";
import { AuthCard } from "../../auth-card";

export const metadata: Metadata = { title: "Sign in with phone", robots: { index: false } };

export default async function PhoneSignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNextPath.parse((await searchParams).next);
  if (await getCurrentUser()) redirect(next ?? "/account");
  return (
    <AuthCard title="Sign in with your phone" description="We'll text you a one-time code. Works for accounts with a verified phone number.">
      <div className="flex flex-col gap-4">
        <PhoneSignIn next={next} />
        <p className="text-center text-sm text-muted-foreground">
          <Link href={next ? `/auth/sign-in?next=${encodeURIComponent(next)}` : "/auth/sign-in"} className="font-semibold text-primary hover:underline">
            Use email and password instead
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
