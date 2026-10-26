import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Button } from "@/components/ui/button";
import { signInWithGoogleAction } from "@/lib/auth/actions";
import { googleEnabled } from "@/lib/auth/config";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

export default async function SignUpPage() {
  if (await getCurrentUser()) redirect("/account");
  return (
    <AuthCard title="Create your account" description="Shop from local stores and book trusted service providers.">
      <div className="flex flex-col gap-4">
        {googleEnabled && (
          <>
            <form action={signInWithGoogleAction}>
              <Button type="submit" variant="outline" className="w-full">
                Continue with Google
              </Button>
            </form>
            <p className="text-center text-xs text-muted-foreground">or sign up with email</p>
          </>
        )}
        <SignUpForm />
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthCard>
  );
}
