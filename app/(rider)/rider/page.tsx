import { Bike, Clock, ShieldCheck, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { AutoRefresh, OnlineSwitch, OpenJobList, MyJobList } from "@/components/rider/pool-jobs";
import { RiderApplyForm } from "@/components/rider/rider-apply-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { decrypt, decryptNullable } from "@/lib/crypto";
import { formatDateTime } from "@/lib/datetime";
import { withRls, withSystemContext } from "@/lib/db";
import { riderJobUrl } from "@/lib/fulfilment/rider-job";
import type { RiderVehicle } from "@/lib/fulfilment/rider-vehicles";
import { formatDistance } from "@/lib/geo/distance";
import { formatPrice } from "@/lib/money";
import { openJobs, poolRiderForUser, riderActiveJobs } from "@/lib/riders/pool";
import { SERVICE_AREAS } from "@/lib/service-area";
import { getCheckoutSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "TownMart rider", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const localPhone = (e164: string) => (e164.startsWith("+234") ? `0${e164.slice(4)}` : e164);
const TOWNS = SERVICE_AREAS.flatMap((a) => a.towns.map((t) => `${t}, ${a.label.split(",")[1]?.trim() ?? ""}`.replace(/, $/, "")));

function Intro() {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { icon: Bike, title: "Deliver in your area", text: "Collect from TownMart shops near you and deliver to customers in your town." },
        { icon: Wallet, title: "Earn from every delivery", text: "You keep most of each delivery fee. You see what a job pays before you take it." },
        { icon: Clock, title: "Work when you want", text: "Go online when you're free. Offline, you get no jobs." },
      ].map((b) => (
        <Card key={b.title}>
          <CardContent className="flex flex-col gap-2 pt-6 text-sm">
            <b.icon className="size-5 text-primary" aria-hidden />
            <p className="font-semibold">{b.title}</p>
            <p className="text-muted-foreground">{b.text}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default async function RiderHomePage() {
  const user = await requirePermission("account.access", "/rider");
  const rider = await withRls({ userId: user.id }, (tx) => poolRiderForUser(tx, user.id));

  if (!rider || rider.status === "pending" || rider.status === "rejected") {
    const initial = rider
      ? {
          name: rider.name,
          phone: localPhone(decrypt(rider.phoneEncrypted)),
          vehicle: rider.vehicle as RiderVehicle,
          plateNumber: rider.plateNumber ?? "",
          homeTown: rider.homeTown ?? "",
          nin: decryptNullable(rider.ninEncrypted) ?? "",
          guarantorName: rider.guarantorName ?? "",
          guarantorPhone: rider.guarantorPhoneEncrypted ? localPhone(decrypt(rider.guarantorPhoneEncrypted)) : "",
        }
      : { name: user.name ?? "", phone: "", vehicle: "motorbike" as RiderVehicle, plateNumber: "", homeTown: TOWNS[0] ?? "", nin: "", guarantorName: "", guarantorPhone: "" };
    return (
      <>
        <PageHeader title={rider ? "Your rider application" : "Ride with TownMart"} description="Deliver orders from TownMart shops in your town and get paid for every delivery." />
        <div className="flex flex-col gap-6">
          {rider?.status === "pending" && (
            <Alert variant="info">
              <ShieldCheck className="inline size-4" aria-hidden /> We have your application from {rider.appliedAt ? formatDateTime(rider.appliedAt) : "earlier"}. TownMart will call you and your guarantor, and may ask to see your ID and vehicle papers. We&apos;ll text you when you&apos;re approved. You can update your details below meanwhile.
            </Alert>
          )}
          {rider?.status === "rejected" && (
            <Alert variant="warning">
              We couldn&apos;t approve your application{rider.reviewNote ? `: ${rider.reviewNote}` : "."} You can fix your details and apply again.
            </Alert>
          )}
          {!rider && <Intro />}
          <Card>
            <CardHeader>
              <CardTitle>{rider ? "Your details" : "Apply to ride"}</CardTitle>
              <CardDescription>TownMart checks every rider before they can take jobs. Your NIN and your guarantor&apos;s number are only seen by the TownMart team.</CardDescription>
            </CardHeader>
            <CardContent>
              <RiderApplyForm initial={initial} towns={TOWNS} resubmit={Boolean(rider)} />
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  if (rider.status === "suspended" || !rider.isActive) {
    return (
      <>
        <PageHeader title="TownMart rider" />
        <Alert variant="warning">Your rider account is paused{rider.reviewNote ? `: ${rider.reviewNote}` : "."} Please contact TownMart if you think this is a mistake.</Alert>
      </>
    );
  }

  const { jobs, mine, settings, earned } = await withSystemContext(async (tx) => {
    const settings = await getCheckoutSettings(tx);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);
    const done = await tx.sellerOrder.aggregate({
      where: { riderId: rider.id, status: { in: ["delivered", "completed"] }, deliveredAt: { gte: weekAgo }, riderPayKobo: { not: null } },
      _sum: { riderPayKobo: true },
      _count: true,
    });
    return {
      settings,
      jobs: rider.isAvailable ? await openJobs(tx, rider, settings.riderPoolSharePercent) : [],
      mine: await riderActiveJobs(tx, rider.id),
      earned: { count: done._count, kobo: done._sum.riderPayKobo ?? 0n },
    };
  });

  return (
    <>
      <PageHeader title={`Hello, ${rider.name.split(" ")[0]}`} description="Go online to get jobs. The first rider to take a job gets it." />
      <AutoRefresh seconds={30} />
      <div className="flex flex-col gap-6">
        <OnlineSwitch online={rider.isAvailable} />
        <Card>
          <CardHeader>
            <CardTitle>Your deliveries</CardTitle>
            <CardDescription>
              Last 7 days: {earned.count} delivered, {formatPrice(earned.kobo)} earned. You can hold {settings.riderPoolMaxJobs} deliver{settings.riderPoolMaxJobs === 1 ? "y" : "ies"} at a time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MyJobList
              jobs={mine.map((j) => ({
                sellerOrderId: j.id,
                orderNumber: j.orderNumber,
                shop: `${j.business.name}, ${j.business.city}`,
                pay: j.riderPayKobo !== null ? formatPrice(j.riderPayKobo) : null,
                stage: j.pickedUpAt || j.status === "shipped" ? "On the way" : "Go to the shop",
                pickedUp: Boolean(j.pickedUpAt) || j.status === "shipped",
                payOnDelivery: j.payOnDelivery,
                jobUrl: riderJobUrl(j),
              }))}
            />
          </CardContent>
        </Card>
        {rider.isAvailable && (
          <Card>
            <CardHeader>
              <CardTitle>Jobs open now</CardTitle>
              <CardDescription>Nearest first. You see the customer&apos;s address and number once the job is yours.</CardDescription>
            </CardHeader>
            <CardContent>
              <OpenJobList
                jobs={jobs.map((j) => ({
                  sellerOrderId: j.sellerOrderId,
                  orderNumber: j.orderNumber,
                  shop: `${j.shop}, ${j.shopArea}`,
                  dropOff: j.dropOff,
                  distance: j.deliveryMetres !== null ? formatDistance(j.deliveryMetres) : null,
                  toShop: j.metresToShop !== null ? formatDistance(j.metresToShop) : null,
                  pay: formatPrice(j.payKobo),
                  payOnDelivery: j.payOnDelivery,
                  items: j.itemCount,
                  waiting: formatDateTime(j.openedAt),
                }))}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
