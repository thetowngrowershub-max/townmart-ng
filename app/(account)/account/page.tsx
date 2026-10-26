import type { Metadata } from "next";
import Link from "next/link";
import { ResendVerification } from "@/components/auth/resend-verification";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";

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

  return (
    <>
      <PageHeader title={`Hello${user.name ? `, ${user.name.split(" ")[0]}` : ""}`} description="Manage your orders, bookings and account." />
      <div className="flex flex-col gap-6">
        {welcome && <Alert variant="success">Welcome to TownMart! Your account is ready.</Alert>}
        {!user.emailVerified && <ResendVerification email={user.email} />}

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
