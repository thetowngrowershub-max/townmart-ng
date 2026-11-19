import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { BusinessStatusBadge } from "@/components/admin/seller-status-badge";
import { BrandingForm } from "@/components/seller/onboarding/branding-form";
import { PayoutForm } from "@/components/seller/onboarding/payout-form";
import { OpeningHoursForm } from "@/components/seller/opening-hours-form";
import { StorePoliciesForm } from "@/components/seller/store-policies-form";
import { ShopLocationForm } from "@/components/seller/shop-location-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { parseOpeningHours } from "@/lib/catalogue/opening-hours";
import { minutesToTime } from "@/lib/catalogue/units";
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
      select: { name: true, slug: true, status: true, type: true, description: true, logoKey: true, bannerKey: true, city: true, latitude: true, longitude: true, state: { select: { name: true } } },
    }),
    policy: await tx.storePolicy.findUnique({ where: { businessId: ctx.business.id } }),
    payout: await tx.payoutAccount.findUnique({ where: { businessId: ctx.business.id } }),
  }));
  const banks = await bankVerifier().listBanks().catch(() => null);
  const hours = parseOpeningHours(policy?.openingHours);
  const isFoodSeller = business.type === "restaurant" || business.type === "confectioner";
  const hoursForm = (
    <Card>
      <CardHeader>
        <CardTitle>Opening hours</CardTitle>
        <CardDescription>
          {isFoodSeller
            ? "Shoppers can order food only while you're open. Set your hours, or pause orders when the kitchen is too busy."
            : "Optional. Set hours if you only take orders at certain times, for example if you cook to order."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <OpeningHoursForm
          initial={{
            useHours: hours !== null,
            ordersPaused: policy?.ordersPaused ?? false,
            days: Array.from({ length: 7 }, (_, d) => {
              const h = hours?.[d];
              // Default for a new schedule: 8 am to 10 pm every day.
              if (!hours) return { isOpen: true, open: "08:00", close: "22:00" };
              return h ? { isOpen: true, open: minutesToTime(h.open), close: h.close === 1440 ? "00:00" : minutesToTime(h.close) } : { isOpen: false, open: "08:00", close: "22:00" };
            }),
          }}
        />
      </CardContent>
    </Card>
  );
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
          {isFoodSeller && hoursForm}
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
          <Card id="shop-location">
            <CardHeader>
              <CardTitle>Shop location</CardTitle>
              <CardDescription>
                Where riders pick up your orders. With it, customers see the delivery fee for their exact distance from you, and we suggest your nearest free rider.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ShopLocationForm current={business.latitude !== null && business.longitude !== null ? { lat: business.latitude, lng: business.longitude } : null} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivery rates</CardTitle>
              <CardDescription>Used only until your shop location is set: after that, delivery is priced by distance. Use TownMart&apos;s rates, or set your own fees and delivery times per area.</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard/settings/delivery" className="text-sm font-medium text-primary underline">
                Manage delivery rates
              </Link>
            </CardContent>
          </Card>
          {!isFoodSeller && hoursForm}
          <Alert variant="info">
            To change your business name, address, phone or type after approval, contact TownMart support so we can re-check your details.
          </Alert>
        </div>
      </div>
    </>
  );
}
