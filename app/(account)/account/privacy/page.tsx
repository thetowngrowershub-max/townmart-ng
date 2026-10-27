import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { CookieChoiceButton, DeleteAccountForm, NameForm, PrivacyRequestForm, RequestExportButton } from "@/components/privacy/privacy-forms";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { getRetention } from "@/lib/compliance/retention";
import { readConsent } from "@/lib/consent/server";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { exportDownloadUrl } from "@/lib/privacy/export";
import { deadline, DSR_STATUS_LABELS, DSR_TYPE_LABELS, OPEN_STATUSES } from "@/lib/privacy/requests";

export const metadata: Metadata = { title: "Privacy Centre" };

const onOff = (v: boolean) => (v ? "On" : "Off");

export default async function PrivacyCentrePage() {
  const user = await requirePermission("account.access", "/account/privacy");
  const now = new Date();
  const { requests, acceptances, retention, prefs, ownsShop } = await withRls({ userId: user.id }, async (tx) => ({
    requests: await tx.dataSubjectRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 }),
    acceptances: await tx.policyAcceptance.findMany({
      where: { userId: user.id },
      orderBy: { acceptedAt: "desc" },
      take: 20,
      include: { document: { select: { slug: true, title: true, version: true } } },
    }),
    retention: await getRetention(tx),
    prefs: await tx.notificationPreference.findUnique({ where: { userId: user.id } }),
    ownsShop: (await tx.business.count({ where: { ownerUserId: user.id } })) > 0,
  }));
  const consent = await readConsent();
  const exports = requests.filter((r) => r.type === "access" || r.type === "portability");
  const exportPending = exports.some((r) => OPEN_STATUSES.includes(r.status));

  return (
    <>
      <PageHeader title="Privacy Centre" description="See, correct and control the personal data TownMart holds about you, under the Nigeria Data Protection Act 2023." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Download your data</CardTitle>
            <CardDescription>A PDF to read and a JSON file you can take to another service. We email you when it&apos;s ready; the link works for {retention.export_link} days.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <RequestExportButton disabled={exportPending} />
            {exports.length > 0 && (
              <ul className="divide-y rounded-xl border text-sm">
                {exports.slice(0, 3).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <div>
                      <p className="font-medium">{r.reference}</p>
                      <p className="text-xs text-muted-foreground">Asked {formatDateTime(r.createdAt)}</p>
                    </div>
                    {r.exportJsonKey && r.exportPdfKey && r.exportExpiresAt && r.exportExpiresAt > now ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <a className="font-medium text-primary underline" href={exportDownloadUrl(r.id, "pdf", r.exportExpiresAt)}>
                          PDF
                        </a>
                        <a className="font-medium text-primary underline" href={exportDownloadUrl(r.id, "json", r.exportExpiresAt)}>
                          JSON
                        </a>
                        <span className="text-xs text-muted-foreground">until {formatDate(r.exportExpiresAt)}</span>
                      </div>
                    ) : OPEN_STATUSES.includes(r.status) ? (
                      <Badge variant="accent">Preparing</Badge>
                    ) : (
                      <Badge variant="secondary">Expired</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your details</CardTitle>
            <CardDescription>Correct anything that&apos;s wrong.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <NameForm name={user.name ?? ""} />
            <ul className="flex flex-col gap-1">
              <li>
                Delivery addresses: <Link href="/account/addresses" className="font-medium text-primary underline">edit in your address book</Link>
              </li>
              <li>
                Phone number and two-step sign-in: <Link href="/account/security" className="font-medium text-primary underline">Profile &amp; security</Link>
              </li>
              <li>Email address ({user.email}): ask us below and we&apos;ll check the new address first.</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Consent</CardTitle>
            <CardDescription>Change these whenever you like. Withdrawing consent doesn&apos;t affect what we did before.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium">Cookies</p>
              <p className="text-muted-foreground">
                {consent
                  ? `Functional ${onOff(consent.functional).toLowerCase()}, analytics ${onOff(consent.analytics).toLowerCase()}, marketing ${onOff(consent.marketing).toLowerCase()} (chosen ${formatDate(consent.at)} on this device).`
                  : "You haven't made a choice on this device, so only necessary cookies are used."}
              </p>
            </div>
            <CookieChoiceButton />
            <div>
              <p className="font-medium">Offers by email</p>
              <p className="text-muted-foreground">{prefs?.marketingEmail ? "On. Every offer email has a one-click unsubscribe link." : "Off. We only send order, booking and account emails."}</p>
              <Link href="/account/notifications" className="font-medium text-primary underline">
                Notification settings
              </Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ask us to do something else</CardTitle>
            <CardDescription>Correct, restrict or object to how we use your data. We reply within {retention.dsr_response} days.</CardDescription>
          </CardHeader>
          <CardContent>
            <PrivacyRequestForm />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Your requests</CardTitle>
            <CardDescription>Everything you&apos;ve asked us, and where it&apos;s up to.</CardDescription>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">No requests yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border text-sm">
                {requests.map((r) => {
                  const due = OPEN_STATUSES.includes(r.status) ? deadline(r.dueAt, now) : null;
                  return (
                    <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 p-3">
                      <div className="min-w-0">
                        <p className="font-medium">
                          {DSR_TYPE_LABELS[r.type]} · {r.reference}
                        </p>
                        <p className="text-xs text-muted-foreground">Asked {formatDateTime(r.createdAt)}</p>
                        {r.resolutionNote && r.status !== "open" && <p className="mt-1 text-muted-foreground">{r.resolutionNote}</p>}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={r.status === "completed" ? "default" : r.status === "rejected" ? "danger" : "secondary"}>{DSR_STATUS_LABELS[r.status]}</Badge>
                        {due && r.dueAt && <span className="text-xs text-muted-foreground">Reply by {formatDate(r.dueAt)}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Agreements you accepted</CardTitle>
            <CardDescription>The exact version of each policy you agreed to, and when.</CardDescription>
          </CardHeader>
          <CardContent>
            {acceptances.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {acceptances.map((a) => (
                  <li key={a.id}>
                    <Link href={`/legal/${a.document.slug}?v=${encodeURIComponent(a.document.version)}`} className="font-medium text-primary underline">
                      {a.document.title}
                    </Link>{" "}
                    <span className="text-muted-foreground">
                      version {a.document.version}, {formatDateTime(a.acceptedAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="border-danger/40 lg:col-span-2">
          <CardHeader>
            <CardTitle>Delete your account</CardTitle>
            <CardDescription>
              We sign you out and delete your account after {retention.deletion_grace} days. Sign in again before then to cancel. Your name, email, phone, addresses, wishlist and sign-in methods are removed; your reviews stay up as &quot;Former customer&quot;. Order, payment and refund records are kept for six years because tax and accounting law requires it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ownsShop ? (
              <Alert variant="warning">You run a shop on TownMart, so closing your account is done by hand. Use &quot;Ask us to do something else&quot; above and choose &quot;Something else&quot;.</Alert>
            ) : (
              <DeleteAccountForm graceDays={retention.deletion_grace} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
