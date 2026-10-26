import { Monitor } from "lucide-react";
import type { Metadata } from "next";
import { RevokeSessionButton } from "@/components/account/revoke-session-button";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { signOutEverywhereAction } from "@/lib/auth/actions";
import { requirePermission } from "@/lib/auth/current-user";
import { currentSessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";

export const metadata: Metadata = { title: "Profile & security" };

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Unknown OS";
  return `${browser} on ${os}`;
}

export default async function SecurityPage() {
  const user = await requirePermission("account.access", "/account/security");
  const token = await currentSessionToken();
  const sessions = await prisma.session.findMany({
    where: { userId: user.id, expires: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, sessionToken: true, userAgent: true, createdAt: true, expires: true },
  });

  return (
    <>
      <PageHeader title="Profile & security" description="See where you're signed in and sign out of other devices." />
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
