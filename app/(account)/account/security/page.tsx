import { Monitor } from "lucide-react";
import type { Metadata } from "next";
import { AccountPhone } from "@/components/account/account-phone";
import { GoogleConnection } from "@/components/account/google-connection";
import { TwoFactorSetting } from "@/components/account/two-factor-setting";
import { RevokeSessionButton } from "@/components/account/revoke-session-button";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutEverywhereAction } from "@/lib/auth/actions";
import { googleEnabled } from "@/lib/auth/config";
import { requirePermission } from "@/lib/auth/current-user";
import { currentSessionToken } from "@/lib/auth/session";
import { decryptNullable } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { maskPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/datetime";

export const metadata: Metadata = { title: "Profile & security" };

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const user = await requirePermission("account.access", "/account/security");
  const { google } = await searchParams;
  const token = await currentSessionToken();
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { phoneEncrypted: true, phoneVerifiedAt: true, twoFactorEnabledAt: true, passwordHash: true, accounts: { where: { provider: "google" }, select: { id: true } } },
  });
  const phone = account.phoneVerifiedAt ? decryptNullable(account.phoneEncrypted) : null;
  const sessions = await prisma.session.findMany({
    where: { userId: user.id, expires: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, sessionToken: true, userAgent: true, createdAt: true, expires: true },
  });

  return (
    <>
      <PageHeader title="Profile & security" description="Your phone number, how you sign in, and where you're signed in." />
      {google === "connected" && <Alert variant="success" className="mb-6">Google is connected. You can now sign in with it.</Alert>}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Phone number</CardTitle>
          <CardDescription>Add a verified number to sign in with a text-message code. We never show it to sellers unless you order from them.</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountPhone masked={phone ? maskPhone(phone) : null} />
        </CardContent>
      </Card>
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Two-step sign-in</CardTitle>
          <CardDescription>Protect your password sign-in with a code sent to your phone.</CardDescription>
        </CardHeader>
        <CardContent>
          <TwoFactorSetting enabled={account.twoFactorEnabledAt !== null} hasPhone={phone !== null} />
        </CardContent>
      </Card>
      {(googleEnabled || account.accounts.length > 0) && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Google</CardTitle>
            <CardDescription>Sign in with your Google account as well as {account.passwordHash ? "your password" : "a text-message code"}.</CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleConnection connected={account.accounts.length > 0} />
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Active sessions</CardTitle>
          <CardDescription>If you don&apos;t recognise a device, sign it out and change your password.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="divide-y rounded-xl border">
            {sessions.map((s) => (
              <li key={s.id} className="flex items-center gap-3 p-4">
                <Monitor className="size-5 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {describeAgent(s.userAgent)} {s.sessionToken === token && <Badge className="ml-1">This device</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground">Signed in {formatDateTime(s.createdAt)}</p>
                </div>
                {s.sessionToken !== token && <RevokeSessionButton sessionId={s.id} />}
              </li>
            ))}
          </ul>
          <form action={signOutEverywhereAction}>
            <Button type="submit" variant="danger">
              Sign out everywhere
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
