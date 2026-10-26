import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { signInWithGoogleAction } from "@/lib/auth/actions";
import { googleEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { safeNextPath } from "@/lib/validation/auth";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

const ERRORS: Record<string, string> = {
  OAuthAccountNotLinked:
    "An account with this email already exists. Sign in with your password instead.",
  AccessDenied: "This account can't sign in right now. Please contact support.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; signedOut?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath.parse(params.next);
  if (await getCurrentUser()) redirect(next ?? "/account");

  return (
    <AuthCard title="Welcome back" description="Sign in to your TownMart account.">
      <div className="flex flex-col gap-4">
        {params.signedOut === "all" && <Alert variant="success">You&apos;ve been signed out on all devices.</Alert>}
        {params.error && <Alert variant="danger">{ERRORS[params.error] ?? "Sign-in failed. Please try again."}</Alert>}
        {googleEnabled && (
          <>
            <form action={signInWithGoogleAction}>
              <input type="hidden" name="next" value={next ?? ""} />
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">or sign in with email</p>
          </>
        )}
        <SignInForm next={next} />
        <Button asChild variant="outline" className="w-full">
          <Link href={next ? `/auth/sign-in/phone?next=${encodeURIComponent(next)}` : "/auth/sign-in/phone"}>Sign in with a phone code</Link>
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          New to TownMart?{" "}
          <Link href="/auth/sign-up" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
