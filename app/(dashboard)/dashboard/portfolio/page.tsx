import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { PortfolioForm } from "@/components/seller/portfolio-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { listPortfolio } from "@/lib/portfolio/portfolio";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";

export const metadata: Metadata = { title: "Job photos" };

export default async function PortfolioPage() {
  const ctx = await requireSellerPage("/dashboard/portfolio", "listing.write");
  const photos = await withSellerRls(ctx, (tx) => listPortfolio(tx, ctx.business.id));
  const live = ctx.business.status === "approved";

  return (
    <>
      <PageHeader
        title="Job photos"
        description="Show customers work you've done. Photos appear under “Jobs done” on your store page and on your service pages."
      />
      {!live && <Alert variant="info" className="mb-4">Customers will see your photos once TownMart approves your store.</Alert>}
      <Card className="max-w-3xl">
        <CardContent className="flex flex-col gap-4 pt-6">
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>Use clear, well-lit photos of your own finished jobs. Before-and-after pairs work well.</li>
            <li>Don&apos;t show customers&apos; faces, house numbers or documents without their permission.</li>
            <li>We remove location data from every photo when you upload it.</li>
          </ul>
          <PortfolioForm initial={photos} />
          {live && photos.length > 0 && (
            <Link href={`/store/${ctx.business.slug}#jobs`} className="text-sm font-medium text-primary underline">
              See them on your store page
            </Link>
          )}
        </CardContent>
      </Card>
    </>
  );
}
