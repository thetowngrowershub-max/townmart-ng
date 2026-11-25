import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { RemoveSaved } from "@/components/storefront/remove-saved";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { servicePriceLabel } from "@/lib/catalogue/format";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { publicImageUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Wishlist" };

type Saved = { key: string; target: { productId: string } | { serviceId: string }; title: string; href: string | null; price: string | null; imageUrl: string | null; seller: string | null };

export default async function WishlistPage() {
  const user = await requirePermission("account.access", "/account/wishlist");
  const saved = await withRls({ userId: user.id }, async (tx): Promise<Saved[]> => {
    const rows = await tx.wishlistItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 200 });
    const productIds = rows.flatMap((r) => (r.productId ? [r.productId] : []));
    const serviceIds = rows.flatMap((r) => (r.serviceId ? [r.serviceId] : []));
    // Listings are read as this shopper sees them: ones taken down drop out and show as unavailable.
    const live = { status: "active", deletedAt: null } as const;
    const [products, services] = await Promise.all([
      tx.product.findMany({ where: { id: { in: productIds }, ...live }, select: { id: true, slug: true, title: true, basePriceKobo: true, business: { select: { name: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { storageKey: true } } } }),
      tx.service.findMany({ where: { id: { in: serviceIds }, ...live }, select: { id: true, slug: true, title: true, basePriceKobo: true, pricingModel: true, business: { select: { name: true } }, images: { take: 1, orderBy: { sortOrder: "asc" }, select: { storageKey: true } } } }),
    ]);
    return rows.map((r) => {
      const p = r.productId ? products.find((x) => x.id === r.productId) : undefined;
      const s = r.serviceId ? services.find((x) => x.id === r.serviceId) : undefined;
      const target = r.productId ? { productId: r.productId } : { serviceId: r.serviceId! };
      if (p) return { key: r.id, target, title: p.title, href: `/p/${p.slug}`, price: formatPrice(p.basePriceKobo), imageUrl: p.images[0] ? publicImageUrl(p.images[0].storageKey) : null, seller: p.business.name };
      if (s) return { key: r.id, target, title: s.title, href: `/s/${s.slug}`, price: servicePriceLabel(s.pricingModel, s.basePriceKobo), imageUrl: s.images[0] ? publicImageUrl(s.images[0].storageKey) : null, seller: s.business.name };
      return { key: r.id, target, title: "No longer available", href: null, price: null, imageUrl: null, seller: null };
    });
  });

  return (
    <>
      <PageHeader title="Wishlist" description="Things you saved for later." />
      {saved.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 py-8">
            <p className="text-muted-foreground">Nothing saved yet. Tap Save on any product or service to keep it here.</p>
            <Button asChild>
              <Link href="/">Start shopping</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {saved.map((i) => (
            <li key={i.key} className="flex items-center gap-3 rounded-2xl border bg-card p-3">
              <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">{i.imageUrl && <Image src={i.imageUrl} alt="" fill sizes="64px" className="object-cover" />}</div>
              <div className="min-w-0 flex-1 text-sm">
                {i.href ? (
                  <Link href={i.href} className="line-clamp-2 font-medium hover:underline">
                    {i.title}
                  </Link>
                ) : (
                  <p className="text-muted-foreground">{i.title}</p>
                )}
                {i.seller && <p className="text-muted-foreground">{i.seller}</p>}
                {i.price && <p className="font-semibold">{i.price}</p>}
              </div>
              <RemoveSaved target={i.target} title={i.title} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
