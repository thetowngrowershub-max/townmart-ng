import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { accessLog, consentLog } from "@/lib/compliance/view";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Consent & access logs" };

const yn = (v: boolean) => (v ? "yes" : "no");
const ACTION_LABELS: Record<string, string> = {
  "personal_data.viewed": "Opened",
  "business.application_viewed": "Opened seller application",
  "kyc.document_viewed": "Opened KYC document",
};

export default async function LogsPage() {
  const user = await requirePermission("compliance.manage", "/admin/compliance/logs");
  const { consent, access } = await withRls({ scope: "admin", userId: user.id }, async (tx) => ({ consent: await consentLog(tx), access: await accessLog(tx) }));
  return (
    <>
      <PageHeader title="Consent & access logs" description="Proof of cookie choices, and every time staff opened someone's personal data. Latest 100 of each." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Staff access to personal data</CardTitle>
            <CardDescription>Written automatically whenever an admin page shows contact details, documents or a data request.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto" tabIndex={0} role="region" aria-label="Staff access to personal data">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Who</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 font-medium">Record</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {access.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(a.createdAt)}</td>
                    <td className="py-2 pr-3">{a.actorEmail}</td>
                    <td className="py-2 pr-3">
                      {ACTION_LABELS[a.action] ?? a.action}
                      {Array.isArray((a.after as { fields?: string[] } | null)?.fields) ? `: ${(a.after as { fields: string[] }).fields.join(", ")}` : ""}
                    </td>
                    <td className="py-2 font-mono text-xs">
                      {a.entityType} {a.entityId}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {access.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing yet.</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cookie choices</CardTitle>
            <CardDescription>Each choice as made, with the Cookie Policy version shown at the time. IP addresses are stored only as a keyed hash.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto" tabIndex={0} role="region" aria-label="Cookie choices">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">When</th>
                  <th className="py-2 pr-3 font-medium">Who</th>
                  <th className="py-2 pr-3 font-medium">Functional</th>
                  <th className="py-2 pr-3 font-medium">Analytics</th>
                  <th className="py-2 pr-3 font-medium">Marketing</th>
                  <th className="py-2 pr-3 font-medium">Policy</th>
                  <th className="py-2 font-medium">From</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {consent.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(c.createdAt)}</td>
                    <td className="py-2 pr-3">{c.user?.email ?? `Visitor ${c.subjectId.slice(0, 8)}`}</td>
                    <td className="py-2 pr-3">{yn(c.functional)}</td>
                    <td className="py-2 pr-3">{yn(c.analytics)}</td>
                    <td className="py-2 pr-3">{yn(c.marketing)}</td>
                    <td className="py-2 pr-3">{c.policyVersion}</td>
                    <td className="py-2">{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {consent.length === 0 && <p className="py-4 text-sm text-muted-foreground">Nothing yet.</p>}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
