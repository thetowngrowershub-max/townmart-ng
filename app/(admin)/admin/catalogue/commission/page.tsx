import type { Metadata } from "next";
import { CommissionRuleForm, DeleteRuleButton } from "@/components/admin/catalogue-forms";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { formatPrice } from "@/lib/money";
import { getCheckoutSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Commission" };

const pct = (bps: number) => `${(bps / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 })}%`;

export default async function CommissionPage() {
  const user = await requirePermission("settings.manage", "/admin/catalogue/commission");
  const now = new Date();
  const { rules, categories, sellers, settings } = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const [rules, categories, sellers, settings] = await Promise.all([
      tx.commissionRule.findMany({ orderBy: { effectiveFrom: "desc" }, include: { category: { select: { name: true } }, business: { select: { name: true } } } }),
      tx.category.findMany({ orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } }),
      tx.business.findMany({ where: { status: "approved" }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      getCheckoutSettings(tx),
    ]);
    return { rules, categories, sellers, settings };
  });

  // The rule in force for each target is the latest one that has started; older ones are history.
  const seen = new Set<string>();
  const rows = rules.map((r) => {
    const target = r.scope === "global" ? "global" : `${r.scope}:${r.categoryId ?? r.businessId}`;
    const scheduled = r.effectiveFrom > now;
    const current = !scheduled && !seen.has(target);
    if (current) seen.add(target);
    return { ...r, scheduled, current };
  });
  const label = (r: (typeof rows)[number]) => (r.scope === "global" ? "Every sale" : r.scope === "category" ? `Category: ${r.category?.name}` : `Seller: ${r.business?.name}`);

  return (
    <>
      <PageHeader
        title="Commission"
        description={`What TownMart keeps from each sale. A seller rule beats a category rule, which beats the parent category, then the global rule. With no rule, the default of ${pct(settings.defaultCommissionBps)} applies.`}
      />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a rule</CardTitle>
            <CardDescription>Rules apply to orders placed after they start. Past orders keep the commission they were charged.</CardDescription>
          </CardHeader>
          <CardContent>
            <CommissionRuleForm categories={categories.map((c) => ({ id: c.id, name: `${c.name} (${c.kind})` }))} sellers={sellers} />
          </CardContent>
        </Card>
        <Card className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Commission rules">
          <table className="w-full min-w-[640px] text-sm">
            <caption className="sr-only">Commission rules</caption>
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Applies to</th>
                <th className="px-4 py-2 font-medium">Rate</th>
                <th className="px-4 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No rules yet. Every sale uses the default.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-medium">{label(r)}</td>
                  <td className="px-4 py-2 tabular-nums">
                    {pct(r.percentBps)}
                    {r.fixedKobo > 0n && ` + ${formatPrice(r.fixedKobo)}`}
                  </td>
                  <td className="px-4 py-2">{formatDateTime(r.effectiveFrom)}</td>
                  <td className="px-4 py-2">{r.scheduled ? <Badge variant="warning">Scheduled</Badge> : r.current ? <Badge variant="success">In force</Badge> : <Badge variant="secondary">Replaced</Badge>}</td>
                  <td className="px-4 py-2 text-right">{(r.current || r.scheduled) && <DeleteRuleButton id={r.id} label={label(r)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
