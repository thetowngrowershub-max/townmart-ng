import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BusinessStatusBadge, KycStatusBadge } from "@/components/admin/seller-status-badge";
import { SellerReviewPanel } from "@/components/admin/seller-review-panel";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { writeAudit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { decrypt } from "@/lib/crypto";
import { withRls } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import { requestMeta } from "@/lib/request";
import { publicImageUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Seller application" };

const DOC_LABELS: Record<string, string> = {
  nin_slip: "NIN slip",
  drivers_licence: "Driver's licence",
  intl_passport: "International passport",
  voters_card: "Voter's card",
  cac_certificate: "CAC certificate",
};

export default async function SellerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("seller.review", `/admin/sellers/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const meta = await requestMeta();

  const b = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const row = await tx.business.findUnique({
      where: { id },
      include: {
        owner: { select: { email: true, name: true, createdAt: true } },
        state: { select: { name: true } },
        lga: { select: { name: true } },
        kyc: true,
        payoutAccount: true,
        _count: { select: { products: true, services: true } },
      },
    });
    // Opening an application reveals encrypted contact details: log it.
    if (row) await writeAudit(tx, { actorUserId: user.id, action: "business.application_viewed", entityType: "business", entityId: row.id, ipHash: meta.ipHash });
    return row;
  });
  if (!b) notFound();

  const decisions = (
    [
      b.status === "pending" && { decision: "start_review", label: "Start review", variant: "default" },
      b.kyc?.verificationStatus === "pending" && { decision: "kyc_verified", label: "Mark ID verified" },
      b.kyc && ["pending", "verified"].includes(b.kyc.verificationStatus) && { decision: "kyc_failed", label: "ID failed", variant: "danger" },
      ["pending", "under_review", "suspended"].includes(b.status) && { decision: "approve", label: b.status === "suspended" ? "Reinstate" : "Approve", variant: "default" },
      ["pending", "under_review"].includes(b.status) && { decision: "reject", label: "Request changes", variant: "danger" },
      b.status === "approved" && { decision: "suspend", label: "Suspend", variant: "danger" },
    ] as const
  ).filter(Boolean) as Parameters<typeof SellerReviewPanel>[0]["decisions"];

  const rows: [string, React.ReactNode][] = [
    ["Type", <span key="t" className="capitalize">{b.type.replace("_", " ")}</span>],
    ["Store address", <Link key="s" href={`/store/${b.slug}`} className="text-primary underline">/store/{b.slug}</Link>],
    ["CAC number", b.cacNumber ?? "—"],
    ["Email", b.email],
    ["Phone", `${decrypt(b.phoneEncrypted)}${b.phoneVerifiedAt ? " (verified)" : " (not verified)"}`],
    ["Address", `${decrypt(b.addressEncrypted)}, ${b.city}, ${b.lga.name}, ${b.state.name}`],
    ["Sells", [b.sellsProducts && "products", b.sellsServices && "services"].filter(Boolean).join(" and ")],
    ["Owner", `${b.owner.name ?? "—"} <${b.owner.email}>, joined ${formatDateTime(b.owner.createdAt)}`],
    ["Agreements", b.sellerAgreementAcceptedAt ? `Seller Agreement ${b.sellerAgreementVersion}, DPA ${b.dpaVersion}, accepted ${formatDateTime(b.sellerAgreementAcceptedAt)}` : "Not accepted"],
    ["Submitted", b.submittedAt ? formatDateTime(b.submittedAt) : "—"],
    ["Listings", `${b._count.products} products, ${b._count.services} services`],
  ];

  return (
    <>
      <PageHeader
        title={b.name}
        description={b.description ?? undefined}
        actions={
          <Link href="/admin/sellers" className="text-sm text-primary underline">
            Back to queue
          </Link>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center gap-2">
            <CardTitle className="mr-auto">Decision</CardTitle>
            <BusinessStatusBadge status={b.status} />
            {b.kyc && <KycStatusBadge status={b.kyc.verificationStatus} />}
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {b.rejectionReason && <p className="text-sm"><strong>Last reason given:</strong> {b.rejectionReason}</p>}
            <SellerReviewPanel businessId={b.id} decisions={decisions} />
          </CardContent>
        </Card>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Business</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-3 text-sm">
                {rows.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[120px_1fr] gap-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="min-w-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Identity documents</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {!b.kyc || b.kyc.documentKeys.length === 0 ? (
                  <p className="text-muted-foreground">None uploaded.</p>
                ) : (
                  <>
                    <p>{DOC_LABELS[b.kyc.idDocumentType ?? ""] ?? b.kyc.idDocumentType}</p>
                    {can(user, "kyc.document.view") ? (
                      <ul className="flex flex-col gap-1">
                        {b.kyc.documentKeys.map((key, i) => (
                          <li key={key}>
                            <a href={`/api/admin/kyc/${b.id}/${i}`} target="_blank" rel="noopener noreferrer" className="text-primary underline">
                              Open document {i + 1} ({key.endsWith(".pdf") ? "PDF" : "image"})
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">You don&apos;t have permission to open KYC documents.</p>
                    )}
                    <p className="text-xs text-muted-foreground">Links expire after 60 seconds. Every view is recorded in the audit log.</p>
                    {b.kyc.notes && <p><strong>Notes:</strong> {b.kyc.notes}</p>}
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Payout account</CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {b.payoutAccount ? (
                  <p>
                    {b.payoutAccount.accountName}, {b.payoutAccount.bankName} ••••{b.payoutAccount.accountNumberLast4}
                    {b.payoutAccount.verifiedAt ? ` (name confirmed with the bank ${formatDateTime(b.payoutAccount.verifiedAt)})` : ""}
                  </p>
                ) : (
                  <p className="text-muted-foreground">Not added.</p>
                )}
              </CardContent>
            </Card>
            {(b.logoKey || b.bannerKey) && (
              <Card>
                <CardHeader>
                  <CardTitle>Branding</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center gap-4">
                  {/* eslint-disable @next/next/no-img-element -- admin previews of seller uploads */}
                  {b.logoKey && <img src={publicImageUrl(b.logoKey)} alt="Logo" className="size-20 rounded-xl border object-cover" />}
                  {b.bannerKey && <img src={publicImageUrl(b.bannerKey)} alt="Banner" className="h-20 rounded-xl border object-cover" />}
                  {/* eslint-enable @next/next/no-img-element */}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
