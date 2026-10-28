import type { Metadata } from "next";
import { PlatformSettingsForm } from "@/components/admin/catalogue-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { koboToNairaString } from "@/lib/money";
import { getCheckoutSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Platform settings" };

export default async function PlatformSettingsPage() {
  const user = await requirePermission("settings.manage", "/admin/catalogue/settings");
  const s = await withRls({ scope: "admin", userId: user.id }, (tx) => getCheckoutSettings(tx));
  // Show what's in force (stored value, or the default), in the units the form uses.
  const pct = (bps: number) => String(bps / 100);
  const naira = (kobo: bigint) => koboToNairaString(kobo).replace(/\.00$/, "");
  const initial: Record<string, string | boolean> = {
    "fees.service_fee_percent": pct(s.serviceFeeBps),
    "fees.service_fee_cap_naira": naira(s.serviceFeeCapKobo),
    "fees.vat_percent": pct(s.vatBps),
    "commission.default_percent": pct(s.defaultCommissionBps),
    "checkout.stock_hold_minutes": String(s.stockHoldMinutes),
    "payments.pay_on_delivery_enabled": s.payOnDeliveryEnabled,
    "orders.auto_complete_days": String(s.autoCompleteDays),
    "refunds.seller_response_hours": String(s.refundResponseHours),
    "refunds.late_cancel_percent": String(s.lateCancelRefundPercent),
    "escrow.release_days": String(s.escrowReleaseDays),
    "payouts.minimum_naira": naira(s.payoutMinimumKobo),
    "bookings.lead_minutes": String(s.bookingLeadMinutes),
    "bookings.days_ahead": String(s.bookingDaysAhead),
  };
  return (
    <>
      <PageHeader title="Platform settings" description="Fees, deadlines and limits for the whole marketplace. Changes apply to new orders, bookings and payouts, never to ones already placed." />
      <Card>
        <CardContent className="pt-6">
          <PlatformSettingsForm initial={initial} />
        </CardContent>
      </Card>
    </>
  );
}
