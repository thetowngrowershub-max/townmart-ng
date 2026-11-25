import type { Metadata } from "next";
import Link from "next/link";
import { KeywordsForm } from "@/components/moderation/moderation-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";
import { getKeywords } from "@/lib/moderation/core";

export const metadata: Metadata = { title: "Prohibited items" };

export default async function KeywordsPage() {
  const user = await requirePermission("moderation.manage", "/admin/moderation/keywords");
  const keywords = await withRls({ scope: "admin", userId: user.id }, (tx) => getKeywords(tx));
  return (
    <>
      <PageHeader
        title="Prohibited items"
        description="When a seller saves or imports a listing that mentions one of these, it's flagged in Reported listings. It stays live until someone decides."
      />
      <Card>
        <CardContent className="flex flex-col gap-4 pt-6">
          <p className="text-sm text-muted-foreground">
            Sellers see the full rules on the{" "}
            <Link href="/legal/prohibited-items" className="font-medium text-primary underline">
              Prohibited Items page
            </Link>
            . Keep this list to words that are almost always a problem, so the queue stays useful.
          </p>
          <KeywordsForm initial={keywords} />
        </CardContent>
      </Card>
    </>
  );
}
