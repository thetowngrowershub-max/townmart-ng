import { ImageOff, MapPin, Store } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { formatPrice } from "@/lib/money";
import type { ProductHit, ServiceHit, StoreHit } from "@/lib/search";
import { publicImageUrl } from "@/lib/storage";
import { Rating } from "./rating";

const IMAGE_SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

function Thumb({ imageKey, alt }: { imageKey: string | null; alt: string }) {
  return (
    <div className="relative aspect-square overflow-hidden rounded-xl bg-muted">
      {imageKey ? (
        <Image src={publicImageUrl(imageKey)} alt={alt} fill sizes={IMAGE_SIZES} className="object-cover transition-transform group-hover:scale-[1.03]" />
      ) : (
        <ImageOff className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

export function ProductCard({ p }: { p: ProductHit }) {
  const discount = p.compareAtPriceKobo && p.compareAtPriceKobo > p.priceKobo ? Number(((p.compareAtPriceKobo - p.priceKobo) * 100n) / p.compareAtPriceKobo) : 0;
  return (
    <article className="group relative flex flex-col gap-2">
      <Thumb imageKey={p.coverKey} alt={p.coverAlt ?? p.title} />
      {discount >= 1 && (
        <Badge variant="accent" className="absolute top-2 left-2">
          -{discount}%
        </Badge>
      )}
      {!p.inStock && (
        <Badge variant="secondary" className="absolute top-2 right-2">
          Out of stock
        </Badge>
      )}
      <h3 className="line-clamp-2 text-sm font-medium">
        <Link href={`/p/${p.slug}`} className="after:absolute after:inset-0">
          {p.title}
        </Link>
      </h3>
      <p className="flex flex-wrap items-baseline gap-2">
        <span className="font-bold">{formatPrice(p.priceKobo)}</span>
        {discount >= 1 && <s className="text-xs text-muted-foreground">{formatPrice(p.compareAtPriceKobo!)}</s>}
      </p>
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <MapPin className="size-3" aria-hidden /> {p.business.name} · {p.business.city}
      </p>
      <Rating avg={p.ratingAvg} count={p.ratingCount} />
    </article>
  );
}

export function servicePriceLabel(model: string, kobo: bigint) {
  if (model === "hourly") return `${formatPrice(kobo)}/hr`;
  if (model === "from" || model === "packages") return `From ${formatPrice(kobo)}`;
  return formatPrice(kobo);
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h >= 24 && m === 0 && h % 24 === 0) return `${h / 24} day${h === 24 ? "" : "s"}`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

export function ServiceCard({ s }: { s: ServiceHit }) {
  return (
    <article className="group relative flex flex-col gap-2">
      <Thumb imageKey={s.coverKey} alt={s.coverAlt ?? s.title} />
      <h3 className="line-clamp-2 text-sm font-medium">
        <Link href={`/s/${s.slug}`} className="after:absolute after:inset-0">
          {s.title}
        </Link>
      </h3>
      <p className="font-bold">{servicePriceLabel(s.pricingModel, s.priceKobo)}</p>
      <p className="text-xs text-muted-foreground">
        About {formatDuration(s.durationMinutes)} · {s.business.name}, {s.business.city}
      </p>
      <Rating avg={s.ratingAvg} count={s.ratingCount} />
    </article>
  );
}

export function StoreCard({ s }: { s: StoreHit }) {
  return (
    <article className="relative flex items-center gap-4 rounded-2xl border bg-card p-4 hover:shadow-md">
      <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-muted">
        {s.logoKey ? (
          <Image src={publicImageUrl(s.logoKey)} alt="" fill sizes="64px" className="object-cover" />
        ) : (
          <Store className="absolute top-1/2 left-1/2 size-6 -translate-1/2 text-muted-foreground" aria-hidden />
        )}
      </div>
      <div className="min-w-0">
        <h3 className="truncate font-semibold">
          <Link href={`/store/${s.slug}`} className="after:absolute after:inset-0">
            {s.name}
          </Link>
        </h3>
        <p className="text-xs capitalize text-muted-foreground">
          {s.type.replace("_", " ")} · {s.city}, {s.stateName}
        </p>
        <Rating avg={s.ratingAvg} count={s.ratingCount} />
      </div>
    </article>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}
