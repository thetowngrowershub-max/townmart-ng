import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestControls } from "@/components/compliance/request-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logPersonalDataView } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/current-user";
import { loadDataRequest } from "@/lib/compliance/view";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { deadline, DSR_STATUS_LABELS, DSR_TYPE_LABELS, OPEN_STATUSES } from "@/lib/privacy/requests";
import { requestMeta } from "@/lib/request";

export const metadata: Metadata = { title: "Data request" };

const WHAT_TO_DO: Record<string, string> = {
  access: "Prepare their export if they have an account; otherwise confirm their identity and send what we hold.",
  portability: "Prepare their export: the JSON file is the machine-readable copy.",
  rectification: "Correct the data, or explain why it's accurate.",
  erasure: "Accounts delete themselves from the Privacy Centre after the grace period. For a public request, check identity, then delete or explain what the law makes us keep.",
  restriction: "Stop using the data for the purposes named while the issue is checked.",
  objection: "Stop the processing unless there are compelling legitimate grounds; record them.",
  withdraw_consent: "Switch off the consent named (marketing, cookies) and confirm.",
  other: "Read the details and decide.",
};

export default async function DataRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("compliance.manage", `/admin/compliance/requests/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const meta = await requestMeta();
  const data = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const d = await loadDataRequest(tx, id);
    if (d) await logPersonalDataView(tx, { actorUserId: user.id, entityType: "data_subject_request", entityId: id, fields: ["name", "email", "details", "account"], ipHash: meta.ipHash });
    return d;
  });
  if (!data) notFound();
  const { request: r, account, linked, history } = data;
  const open = OPEN_STATUSES.includes(r.status);
  const due = open ? deadline(r.dueAt) : null;

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="mb-2">
        <Link href="/admin/compliance/requests">
          <ArrowLeft className="size-4" aria-hidden /> All requests
        </Link>
      </Button>
      <PageHeader title={`${r.reference}: ${DSR_TYPE_LABELS[r.type]}`} description={`From ${r.channel === "public_form" ? "the public form" : "the Privacy Centre"}, ${formatDateTime(r.createdAt)}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-6">
          {due && r.dueAt && (
            <Alert variant={due.overdue ? "danger" : due.daysLeft <= 7 ? "warning" : "info"}>
              Reply by {formatDate(r.dueAt)} ({due.label}).
            </Alert>
          )}
          {r.status === "unverified" && <Alert variant="warning">The requester hasn&apos;t confirmed their email yet, so the deadline hasn&apos;t started.</Alert>}
          <Card>
            <CardHeader>
              <CardTitle>Request</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <Badge variant="secondary">{DSR_STATUS_LABELS[r.status]}</Badge>
              </p>
              <p>
                <span className="text-muted-foreground">Name:</span> {r.name ?? "—"}
              </p>
              <p>
                <span className="text-muted-foreground">Email:</span> {r.email} {r.verifiedAt && <span className="text-muted-foreground">(confirmed {formatDateTime(r.verifiedAt)})</span>}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="text-muted-foreground">Details:</span> {r.details ?? "None given"}
              </p>
              {r.resolutionNote && (
                <p className="whitespace-pre-wrap">
                  <span className="text-muted-foreground">Reply:</span> {r.resolutionNote}
                </p>
              )}
            </CardContent>
          </Card>
          {open && (
            <Card>
              <CardHeader>
                <CardTitle>Deal with it</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{WHAT_TO_DO[r.type]}</p>
                <RequestControls id={r.id} status={r.status} canExport={linked && (r.type === "access" || r.type === "portability")} canLink={!linked && !!account && !!r.verifiedAt} />
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {account ? (
                <>
                  <p>{linked ? "Linked to this account:" : "An account uses this email (not linked yet):"}</p>
                  <p className="font-medium">{account.name ?? "No name"}</p>
                  <p className="text-muted-foreground">Status: {account.status}</p>
                  <p className="text-muted-foreground">Joined {formatDate(account.createdAt)}</p>
                  <p className="text-muted-foreground">
                    {account._count.orders} orders{account._count.ownedBusinesses > 0 ? ` · owns ${account._count.ownedBusinesses} shop` : ""}
                  </p>
                  {account.deletionRequestedAt && <p className="text-muted-foreground">Deletion asked for {formatDate(account.deletionRequestedAt)}</p>}
                </>
              ) : (
                <p className="text-muted-foreground">No TownMart account uses this email.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-1 text-sm">
                <li>
                  Received <span className="text-muted-foreground">{formatDateTime(r.createdAt)}</span>
                </li>
                {history.map((h, i) => (
                  <li key={i}>
                    {h.action.replace(/^dsr\./, "").replace(/_/g, " ")} <span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                  </li>
                ))}
                {r.completedAt && (
                  <li>
                    Closed <span className="text-muted-foreground">{formatDateTime(r.completedAt)}</span>
                  </li>
                )}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
