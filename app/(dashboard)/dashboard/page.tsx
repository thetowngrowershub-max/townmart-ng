import { Store } from "lucide-react";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";

export default async function DashboardPage() {
  const user = await requirePermission("dashboard.access", "/dashboard");
  return (
    <>
      <PageHeader title="Overview" description={`Signed in as ${user.email}`} />
      <Card>
        <CardHeader className="flex-row items-center gap-4">
          <Store className="size-8 text-primary" aria-hidden />
          <div>
            <CardTitle>Your store isn&apos;t set up yet</CardTitle>
            <CardDescription>
              Store onboarding (business details, KYC, payout account and branding) opens in the next release. Sales,
              orders, bookings and payout figures will appear here once your store is approved.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent />
      </Card>
    </>
  );
}
