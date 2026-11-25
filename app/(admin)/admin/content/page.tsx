import type { Metadata } from "next";
import Link from "next/link";
import { BannerForm, type BannerValues } from "@/components/admin/content-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { dateToLagosLocal, formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { publicImageUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Homepage banners" };

const EMPTY: BannerValues = { title: "", subtitle: "", image: null, linkUrl: "", ctaLabel: "", sortOrder: "0", startsAt: "", endsAt: "", isActive: true };

export default async function BannersPage() {
  const user = await requirePermission("content.manage", "/admin/content");
  const banners = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.cmsBanner.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] }));
  const now = new Date();
  const state = (b: (typeof banners)[number]) =>
    !b.isActive ? <Badge variant="secondary">Off</Badge> : b.startsAt && b.startsAt > now ? <Badge variant="warning">From {formatDateTime(b.startsAt)}</Badge> : b.endsAt && b.endsAt <= now ? <Badge variant="secondary">Ended</Badge> : <Badge variant="success">Showing</Badge>;

  return (
    <>
      <PageHeader
        title="Homepage banners"
        description={
          <>
            Promotions and announcements across the top of the{" "}
            <Link href="/" className="underline">
              homepage
            </Link>
            . Up to six show, in position order.
          </>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>New banner</CardTitle>
          </CardHeader>
          <CardContent>
            <BannerForm initial={EMPTY} />
          </CardContent>
        </Card>
        {banners.map((b) => (
          <Card key={b.id}>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{b.title}</CardTitle>
                {b.subtitle && <CardDescription>{b.subtitle}</CardDescription>}
              </div>
              {state(b)}
            </CardHeader>
            <CardContent>
              <BannerForm
                initial={{
                  id: b.id,
                  title: b.title,
                  subtitle: b.subtitle ?? "",
                  image: b.imageKey ? { key: b.imageKey, url: publicImageUrl(b.imageKey) } : null,
                  linkUrl: b.linkUrl ?? "",
                  ctaLabel: b.ctaLabel ?? "",
                  sortOrder: String(b.sortOrder),
                  startsAt: b.startsAt ? dateToLagosLocal(b.startsAt) : "",
                  endsAt: b.endsAt ? dateToLagosLocal(b.endsAt) : "",
                  isActive: b.isActive,
                }}
              />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
