import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { BusinessStatusBadge } from "@/components/admin/seller-status-badge";
import { BrandingForm } from "@/components/seller/onboarding/branding-form";
import { PayoutForm } from "@/components/seller/onboarding/payout-form";
import { StorePoliciesForm } from "@/components/seller/store-policies-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { decryptNullable } from "@/lib/crypto";
import { bankVerifier } from "@/lib/payments/banks";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { publicImageUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Store settings" };

export default async function StoreSettingsPage() {
  const ctx = await requireSellerPage("/dashboard/settings", "store.manage");
  const { business, policy, payout } = await withSellerRls(ctx, async (tx) => ({
    business: await tx.business.findUniqueOrThrow({
      where: { id: ctx.business.id },
      select: { name: true, slug: true, status: true, description: true, logoKey: true, bannerKey: true, city: true, state: { select: { name: true } } },
    }),
    policy: await tx.storePolicy.findUnique({ where: { businessId: ctx.business.id } }),
    payout: await tx.payoutAccount.findUnique({ where: { businessId: ctx.business.id } }),
  }));
  const banks = await bankVerifier().listBanks().catch(() => null);
  const delivery = (policy?.deliveryOptions ?? { delivery: true, pickup: false }) as { delivery?: boolean; pickup?: boolean; notes?: string };

  return (
    <>
      <PageHeader title="Store settings" description={`${business.name} · ${business.city}, ${business.state.name}`} actions={<BusinessStatusBadge status={business.status} />} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Branding</CardTitle>
            <CardDescription>
              Your store lives at{" "}
              <Link href={`/store/${business.slug}`} className="text-primary underline">
                /store/{business.slug}
              </Link>
              .
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingForm
              next="/dashboard/settings"
              submitLabel="Save branding"
              initial={{
                description: business.description ?? "",
                logo: business.logoKey ? { key: business.logoKey, url: publicImageUrl(business.logoKey) } : null,
                banner: business.bannerKey ? { key: business.bannerKey, url: publicImageUrl(business.bannerKey) } : null,
              }}
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Policies</CardTitle>
            </CardHeader>
            <CardContent>
              <StorePoliciesForm
                initial={{
                  returnWindowDays: policy?.returnWindowDays ?? 7,
                  acceptsPayOnDelivery: policy?.acceptsPayOnDelivery ?? false,
                  offersDelivery: delivery.delivery ?? true,
                  offersPickup: delivery.pickup ?? false,
                  deliveryNotes: delivery.notes ?? "",
                  pickupAddress: decryptNullable(policy?.pickupAddressEncrypted) ?? "",
                }}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payout account</CardTitle>
            </CardHeader>
            <CardContent>
              {banks ? (
                <PayoutForm banks={banks} next="/dashboard/settings" current={payout ? { bankName: payout.bankName, accountName: payout.accountName, last4: payout.accountNumberLast4 } : null} />
              ) : (
                <Alert variant="danger">We couldn&apos;t load the list of banks. Please refresh in a minute.</Alert>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivery rates</CardTitle>
              <CardDescription>Use TownMart&apos;s rates, or set your own fees and delivery times per area.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/settings/delivery" className="text-sm font-medium text-primary underline">
                Manage delivery rates
              </Link>
            </CardContent>
          </Card>
          <Alert variant="info">
            To change your business name, address, phone or type after approval, contact TownMart support so we can re-check your details.
          </Alert>
        </div>
      </div>
    </>
  );
}
