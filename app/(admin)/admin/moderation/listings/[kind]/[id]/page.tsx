import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListingDecision } from "@/components/moderation/moderation-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { REPORT_REASON_LABELS } from "@/lib/moderation/labels";
import { formatPrice } from "@/lib/money";
import { sanitizeRichText } from "@/lib/sanitize";

export const metadata: Metadata = { title: "Listing" };

export default async function ModerationListingPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  if ((kind !== "product" && kind !== "service") || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const user = await requirePermission("moderation.manage", `/admin/moderation/listings/${kind}/${id}`);
  const data = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const select = {
      id: true,
      title: true,
      slug: true,
      status: true,
      descriptionHtml: true,
      basePriceKobo: true,
      deletedAt: true,
      takenDownAt: true,
      takenDownReason: true,
      createdAt: true,
      business: { select: { id: true, name: true, slug: true, status: true } },
      category: { select: { name: true } },
    } as const;
    const listing = kind === "product" ? await tx.product.findUnique({ where: { id }, select }) : await tx.service.findUnique({ where: { id }, select });
    if (!listing) return null;
    const reports = await tx.listingReport.findMany({ where: kind === "product" ? { productId: id } : { serviceId: id }, orderBy: { createdAt: "desc" }, take: 50 });
    const history = await tx.auditLog.findMany({ where: { entityType: kind, entityId: id, action: { startsWith: "listing." } }, orderBy: { createdAt: "desc" }, take: 20 });
    return { listing, reports, history };
  });
  if (!data) notFound();
  const { listing, reports, history } = data;
  const open = reports.filter((r) => r.status === "open");
  const publicPath = kind === "product" ? `/p/${listing.slug}` : `/s/${listing.slug}`;

  return (
    <>
      <Link href="/admin/moderation" className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Reported listings
      </Link>
      <PageHeader
        title={listing.title}
        description={`${kind === "product" ? "Product" : "Service"} · ${listing.category.name} · ${listing.business.name} · from ${formatPrice(listing.basePriceKobo)}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {listing.takenDownAt ? <Badge variant="danger">Taken down</Badge> : <Badge variant="secondary">{listing.status}</Badge>}
            {listing.deletedAt && <Badge variant="secondary">Deleted by seller</Badge>}
          </div>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Reports</CardTitle>
              <CardDescription>{open.length ? `${open.length} open` : "None open"}. Shoppers aren&apos;t named to the seller.</CardDescription>
            </CardHeader>
            <CardContent>
              {reports.length === 0 ? (
                <p className="text-sm text-muted-foreground">No reports on this listing.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {reports.map((r) => (
                    <li key={r.id} className="flex flex-col gap-1 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{REPORT_REASON_LABELS[r.reason]}</span>
                        <Badge variant={r.status === "open" ? "accent" : "secondary"}>{r.status}</Badge>
                        <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                      </div>
                      {r.matched.length > 0 && <p>Matched: {r.matched.join(", ")}</p>}
                      {r.details && <p className="whitespace-pre-line">{r.details}</p>}
                      {r.resolutionNote && <p className="text-muted-foreground">Decision: {r.resolutionNote}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose-tm max-w-none text-sm" dangerouslySetInnerHTML={{ __html: sanitizeRichText(listing.descriptionHtml) || "<p>No description.</p>" }} />
            </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Decision</CardTitle>
              {listing.takenDownAt && (
                <CardDescription>
                  Taken down {formatDateTime(listing.takenDownAt)}: {listing.takenDownReason}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <ListingDecision listing={{ kind, id }} takenDown={listing.takenDownAt !== null} openReports={open.length} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <a href={publicPath} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary underline">
                Public page <ExternalLink className="size-3.5" aria-hidden />
              </a>
              <Link href={`/admin/sellers/${listing.business.id}`} className="font-medium text-primary underline">
                {listing.business.name} (seller record)
              </Link>
            </CardContent>
          </Card>
          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {history.map((h) => (
                    <li key={h.id}>
                      <span className="font-mono text-xs">{h.action}</span> <span className="text-muted-foreground">· {formatDateTime(h.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
