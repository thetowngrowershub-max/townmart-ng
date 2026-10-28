import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AccountControls, RoleControls } from "@/components/admin/user-controls";
import { PageHeader } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Account" };

const label = (s: string) => s.replace(/_/g, " ");

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requirePermission("user.manage", `/admin/users/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const showAudit = can(actor, "audit_log.read");
  const data = await withRls({ scope: "admin", userId: actor.id }, async (tx) => {
    const u = await tx.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        emailVerified: true,
        phoneVerifiedAt: true,
        twoFactorEnabledAt: true,
        createdAt: true,
        lastLoginAt: true,
        lockedUntil: true,
        deletionRequestedAt: true,
        roles: { select: { role: true, createdAt: true } },
        ownedBusinesses: { select: { id: true, name: true, status: true } },
        staffOf: { select: { business: { select: { id: true, name: true } } } },
        _count: { select: { orders: true, bookings: true, reviews: true, sessions: true } },
      },
    });
    if (!u) return null;
    const [about, by] = await Promise.all([
      tx.auditLog.findMany({ where: { entityType: "user", entityId: id }, orderBy: { createdAt: "desc" }, take: 10 }),
      showAudit ? tx.auditLog.findMany({ where: { actorUserId: id }, orderBy: { createdAt: "desc" }, take: 10 }) : [],
    ]);
    return { u, about, by };
  });
  if (!data) notFound();
  const { u } = data;
  const roles = u.roles.map((r) => r.role);
  const facts: [string, React.ReactNode][] = [
    ["Email", <>{u.email} {u.emailVerified ? <Badge variant="success">Verified</Badge> : <Badge variant="warning">Not verified</Badge>}</>],
    ["Phone", u.phoneVerifiedAt ? "Verified" : "Not verified"],
    ["Two-step sign-in", u.twoFactorEnabledAt ? "On" : "Off"],
    ["Joined", formatDateTime(u.createdAt)],
    ["Last sign-in", u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Never"],
    ["Signed in on", `${u._count.sessions} device${u._count.sessions === 1 ? "" : "s"}`],
    ["Activity", `${u._count.orders} orders · ${u._count.bookings} bookings · ${u._count.reviews} reviews`],
  ];
  if (u.lockedUntil && u.lockedUntil > new Date()) facts.push(["Locked", `Until ${formatDateTime(u.lockedUntil)} after failed sign-ins`]);
  if (u.deletionRequestedAt) facts.push(["Deletion requested", formatDateTime(u.deletionRequestedAt)]);

  const AuditList = ({ rows }: { rows: typeof data.about }) =>
    rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">Nothing recorded.</p>
    ) : (
      <ul className="flex flex-col divide-y text-sm">
        {rows.map((a) => (
          <li key={a.id} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="font-mono text-xs">{a.action}</span>
            <span className="text-xs text-muted-foreground">
              {a.entityType !== "user" && `${a.entityType} · `}
              {formatDateTime(a.createdAt)}
            </span>
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader title={u.name ?? u.email} description={roles.map(label).join(", ") || "No roles"} />
      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
              <CardTitle>Account</CardTitle>
              <Badge variant={u.status === "active" ? "success" : u.status === "suspended" ? "danger" : "secondary"} className="capitalize">
                {label(u.status)}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
                {facts.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="flex flex-wrap items-center gap-2">{v}</dd>
                  </div>
                ))}
              </dl>
              {(u.status === "active" || u.status === "suspended") && <AccountControls userId={u.id} status={u.status} self={u.id === actor.id} />}
            </CardContent>
          </Card>
          {(u.ownedBusinesses.length > 0 || u.staffOf.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Stores</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2 text-sm">
                  {u.ownedBusinesses.map((b) => (
                    <li key={b.id}>
                      <Link href={`/admin/sellers/${b.id}`} className="font-medium underline-offset-2 hover:underline">
                        {b.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">· owner · {label(b.status)}</span>
                    </li>
                  ))}
                  {u.staffOf.map((s) => (
                    <li key={s.business.id}>
                      <Link href={`/admin/sellers/${s.business.id}`} className="font-medium underline-offset-2 hover:underline">
                        {s.business.name}
                      </Link>{" "}
                      <span className="text-muted-foreground">· staff</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
          {can(actor, "user.roles.manage") && (
            <Card>
              <CardHeader>
                <CardTitle>TownMart roles</CardTitle>
                <CardDescription>Seller roles come with a store and aren&apos;t changed here.</CardDescription>
              </CardHeader>
              <CardContent>
                <RoleControls userId={u.id} roles={roles} />
              </CardContent>
            </Card>
          )}
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Changes to this account</CardTitle>
            </CardHeader>
            <CardContent>
              <AuditList rows={data.about} />
            </CardContent>
          </Card>
          {showAudit && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">What they did</CardTitle>
                <CardDescription>
                  <Link href={`/admin/users/audit?actor=${encodeURIComponent(u.email)}`} className="underline">
                    See everything in the audit log
                  </Link>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AuditList rows={data.by} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
