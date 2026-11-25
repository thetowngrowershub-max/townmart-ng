import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isTestMode } from "@/lib/platform";
import { testSitePassword } from "@/lib/test-mode/access";
import { safeNextPath } from "@/lib/validation/auth";

export function generateMetadata(): Metadata {
  return { title: isTestMode() ? "Test site" : "Opening soon", robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  wrong: "That password isn't right. Try again.",
  limit: "Too many tries. Wait 15 minutes, then try again.",
};

/** The password page in front of a test site, or the live site before it opens. Outside the storefront, so it shows nothing of the site. */
export default async function TestAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const safeNext = safeNextPath.parse(next) ?? "/";
  if (!testSitePassword()) redirect(safeNext);

  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70dvh] w-full max-w-sm flex-col justify-center gap-6 px-4 py-12"
    >
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-2xl font-semibold">
          {isTestMode() ? "TownMart test site" : "TownMart is opening soon"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isTestMode()
            ? "This site is for testing only. Enter the password you were given to continue."
            : "We're getting the shops ready. If you're a TownMart partner, enter the password you were given to continue."}
        </p>
      </div>
      {error && MESSAGES[error] ? (
        <Alert variant="danger">{MESSAGES[error]}</Alert>
      ) : null}
      <form
        method="post"
        action="/api/test-access"
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="next" value={safeNext} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="test-site-password">Password</Label>
          <Input
            id="test-site-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </div>
        <Button type="submit">Continue</Button>
      </form>
    </main>
  );
}
