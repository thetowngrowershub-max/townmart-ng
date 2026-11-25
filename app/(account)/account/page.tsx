import type { Metadata } from "next";
import Link from "next/link";
import { AccountPhone } from "@/components/account/account-phone";
import { ResendVerification } from "@/components/auth/resend-verification";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { readPendingPhone } from "@/lib/auth/pending-phone";
import { can } from "@/lib/authz";
import { decryptNullable } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { maskPhone } from "@/lib/phone";

export const metadata: Metadata = { title: "My account" };

const ROLE_LABELS: Record<string, string> = {
  customer: "Customer",
  merchant: "Merchant",
  service_provider: "Service provider",
  staff: "Store staff",
  admin: "Admin",
  super_admin: "Super admin",
};

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const user = await requirePermission("account.access", "/account");
  const { welcome } = await searchParams;
  const account = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { phoneEncrypted: true, phoneVerifiedAt: true } });
  const phone = account.phoneVerifiedAt ? decryptNullable(account.phoneEncrypted) : null;
  const pendingPhone = phone ? null : await readPendingPhone(user.id);

  return (
    <>
      <PageHeader title={`Hello${user.name ? `, ${user.name.split(" ")[0]}` : ""}`} description="Manage your orders, bookings and account." />
      <div className="flex flex-col gap-6">
        {welcome && <Alert variant="success">Welcome to TownMart! Your account is ready.</Alert>}
        {!user.emailVerified && <ResendVerification email={user.email} />}
        {!phone && (pendingPhone || welcome) && (
          <Card>
            <CardHeader>
              <CardTitle>{pendingPhone ? "Confirm your phone number" : "Add your phone number"}</CardTitle>
              <CardDescription>
                {pendingPhone
                  ? "Type the code we texted you. You can then sign in with a text-message code instead of your password."
                  : "Verify a number to sign in with a text-message code instead of your password."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AccountPhone masked={null} pendingPhone={pendingPhone ?? undefined} pendingMessage={pendingPhone ? `We've texted a 6-digit code to ${maskPhone(pendingPhone)}. It expires in 10 minutes.` : undefined} />
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your sign-in details.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Name</p>
                <p className="font-medium">{user.name ?? "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Email</p>
                <p className="flex items-center gap-2 font-medium">
                  {user.email}
                  {user.emailVerified ? <Badge variant="default">Verified</Badge> : <Badge variant="accent">Unverified</Badge>}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Phone</p>
                <p className="flex items-center gap-2 font-medium">
                  {phone ? (
                    <>
                      {maskPhone(phone)} <Badge variant="default">Verified</Badge>
                    </>
                  ) : (
                    <Link href="/account/security" className="text-primary hover:underline">
                      Add a phone number
                    </Link>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {user.roles.map((r) => (
                  <Badge key={r} variant="secondary">
                    {ROLE_LABELS[r] ?? r}
                  </Badge>
                ))}
              </div>
              <Button asChild variant="outline" size="sm" className="self-start">
                <Link href="/account/security">Profile &amp; security</Link>
              </Button>
            </CardContent>
          </Card>

          {!can(user, "dashboard.access") && (
            <Card className="bg-accent-soft">
              <CardHeader>
                <CardTitle>Sell on TownMart</CardTitle>
                <CardDescription>List products or services and reach customers in your area.</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="accent">
                  <Link href="/sell">Become a seller</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
