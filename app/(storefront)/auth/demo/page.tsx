import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/db";
import { isTestMode } from "@/lib/platform";
import { demoSignInAction } from "@/lib/test-mode/actions";
import { DEMO_ACCOUNTS } from "@/lib/test-mode/demo-accounts";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Demo accounts", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Test-mode sites only: sign in as any seeded demo account in one click. */
export default async function DemoAccountsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!isTestMode()) notFound();
  const { error } = await searchParams;
  const existing = new Set(
    (await prisma.user.findMany({ where: { email: { in: DEMO_ACCOUNTS.map((a) => a.email) } }, select: { email: true } })).map((u) => u.email),
  );
  const accounts = DEMO_ACCOUNTS.filter((a) => existing.has(a.email));

  return (
    <AuthCard title="Demo accounts" description="This is a test site. Sign in as any demo account to try TownMart as that person, without a password.">
      <div className="flex flex-col gap-3">
        {error && <Alert variant="danger">That demo account isn&apos;t available. Try another.</Alert>}
        {accounts.length === 0 && <Alert>The demo data hasn&apos;t been loaded yet. It loads when the site is deployed.</Alert>}
        <ul className="flex flex-col gap-2">
          {accounts.map((a) => (
            <li key={a.email}>
              <form action={demoSignInAction} className="flex items-center justify-between gap-3 rounded-xl border p-3">
                <input type="hidden" name="email" value={a.email} />
                <div className="min-w-0">
                  <p className="font-medium">{a.label}</p>
                  <p className="text-sm text-muted-foreground">{a.note}</p>
                </div>
                <Button type="submit" size="sm" aria-label={`Sign in as ${a.label}`}>
                  Sign in
                </Button>
              </form>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">You can also create your own account. Confirmation emails and SMS codes appear in the test inbox.</p>
      </div>
    </AuthCard>
  );
}
