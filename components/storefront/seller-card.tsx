import { Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatDate } from "@/lib/datetime";
import { publicImageUrl } from "@/lib/storage";
import { Rating } from "./rating";

export function SellerCard({
  business,
  label = "Sold by",
}: {
  business: { name: string; slug: string; logoKey: string | null; city: string; state: { name: string }; ratingAvg: unknown; ratingCount: number; createdAt: Date };
  label?: string;
}) {
  return (
    <Card className="relative flex items-center gap-4 p-4">
      <div className="relative size-14 shrink-0 overflow-hidden rounded-xl bg-muted">
        {business.logoKey ? (
          <Image src={publicImageUrl(business.logoKey)} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <Store className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0 text-sm">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-semibold">
          <Link href={`/store/${business.slug}`} className="after:absolute after:inset-0 hover:underline">
            {business.name}
          </Link>
        </p>
        <p className="text-xs text-muted-foreground">
          {business.city}, {business.state.name} · on TownMart since {formatDate(business.createdAt)}
        </p>
        <Rating avg={Number(business.ratingAvg)} count={business.ratingCount} />
      </div>
    </Card>
  );
}

type DeliveryOptions = { delivery?: boolean; pickup?: boolean; notes?: string };

export function PolicySummary({ policy }: { policy: { returnWindowDays: number; deliveryOptions: unknown; acceptsPayOnDelivery: boolean } | null }) {
  if (!policy) return null;
  const d = (policy.deliveryOptions ?? {}) as DeliveryOptions;
  const ways = [d.delivery && "delivery", d.pickup && "pickup from the store"].filter(Boolean).join(" or ");
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {ways && <li>Available for {ways}. Delivery fees are shown at checkout.</li>}
      {d.notes && <li className="text-muted-foreground">{d.notes}</li>}
      <li>{policy.returnWindowDays > 0 ? `Returns accepted within ${policy.returnWindowDays} days.` : "Returns only for faulty or wrong items."}</li>
    </ul>
  );
}
