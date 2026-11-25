import type { BusinessStatus } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { BusinessStatusBadge, KycStatusBadge } from "@/components/admin/seller-status-badge";
import { PageHeader } from "@/components/layout/app-shell";
import { Card } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { formatDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Seller approvals" };

const TABS: { status: BusinessStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "under_review", label: "Under review" },
  { status: "approved", label: "Approved" },
  { status: "rejected", label: "Rejected" },
  { status: "suspended", label: "Suspended" },
  { status: "draft", label: "Not submitted" },
];

export default async function SellerApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requirePermission("seller.review", "/admin/sellers");
  const requested = (await searchParams).status;
  const status = TABS.find((t) => t.status === requested)?.status ?? "pending";

  const { counts, sellers } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({
    counts: await tx.business.groupBy({ by: ["status"], _count: { _all: true } }),
    sellers: await tx.business.findMany({
      where: { status },
      // Oldest first for the queue, so nobody waits forever.
      orderBy: status === "pending" || status === "under_review" ? { submittedAt: "asc" } : { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        name: true,
        type: true,
        city: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        state: { select: { name: true } },
        kyc: { select: { verificationStatus: true } },
      },
    }),
  }));
  const countOf = (s: BusinessStatus) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Seller approvals" description="Check each application's ID, bank account and details before approving." />
      <nav aria-label="Filter by status" className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/admin/sellers?status=${t.status}`}
            aria-current={t.status === status ? "page" : undefined}
            className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", t.status === status ? "border-primary bg-primary-soft font-semibold text-primary" : "hover:bg-muted")}
          >
            {t.label} <span className="text-muted-foreground">({countOf(t.status)})</span>
          </Link>
        ))}
      </nav>
      <Card className="overflow-hidden">
        {sellers.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3">Business</th>
                  <th scope="col" className="px-4 py-3">Location</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sellers.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/sellers/${s.id}`} className="font-semibold text-primary hover:underline">
                        {s.name}
                      </Link>
                      <p className="text-xs capitalize text-muted-foreground">{s.type.replace("_", " ")}</p>
                    </td>
                    <td className="px-4 py-3">
                      {s.city}, {s.state.name}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <BusinessStatusBadge status={s.status} />
                        {s.kyc && <KycStatusBadge status={s.kyc.verificationStatus} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{s.submittedAt ? formatDateTime(s.submittedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
