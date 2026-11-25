import type { Metadata } from "next";
import { ZoneForm } from "@/components/admin/catalogue-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "New delivery zone" };

export default async function NewZonePage() {
  const user = await requirePermission("settings.manage", "/admin/catalogue/delivery/new");
  const states = await withRls({ scope: "admin", userId: user.id }, (tx) => tx.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }));
  return (
    <>
      <PageHeader title="New delivery zone" />
      <Card>
        <CardContent className="pt-6">
          <ZoneForm initial={{ name: "", stateIds: [], priority: "100", isActive: true }} states={states} />
        </CardContent>
      </Card>
    </>
  );
}
