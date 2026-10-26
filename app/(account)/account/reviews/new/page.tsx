import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/app-shell";
import { ReviewForm } from "@/components/reviews/review-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withSystemContext } from "@/lib/db";
import { findReviewable } from "@/lib/reviews/reviews";
import { publicImageUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Write a review" };

export default async function NewReviewPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  const { item } = await searchParams;
  if (!item || !/^[0-9a-f-]{36}$/i.test(item)) notFound();
  const user = await requirePermission("account.access", `/account/reviews/new?item=${item}`);
  // findReviewable checks the item is this shopper's and meets the verified-purchase rule.
  const target = await withSystemContext((tx) => findReviewable(tx, user.id, item));

  return (
    <>
      <PageHeader title="Write a review" />
      {!target ? (
        <Alert variant="info">This item can&apos;t be reviewed. You may have reviewed it already, or it hasn&apos;t been delivered or done yet.</Alert>
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-6 pt-6">
            <div className="flex items-center gap-3">
              <div className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                {target.imageKey && <Image src={publicImageUrl(target.imageKey)} alt="" fill sizes="56px" className="object-cover" />}
              </div>
              <div>
                <p className="font-medium">{target.title}</p>
                <p className="text-sm text-muted-foreground">from {target.businessName}</p>
              </div>
            </div>
            <ReviewForm orderItemId={target.orderItemId} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
