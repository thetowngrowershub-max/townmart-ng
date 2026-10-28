import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/app-shell";
import { InvitationControls, InviteStaffForm, StaffMemberControls } from "@/components/seller/staff-forms";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/datetime";
import { requireSellerPage, withSellerRls } from "@/lib/seller/context";
import { STAFF_FLAGS } from "@/lib/staff/flags";

export const metadata: Metadata = { title: "Staff" };

const access = (flags: Record<string, boolean>) => STAFF_FLAGS.filter((f) => flags[f.key]).map((f) => f.label);

export default async function StaffPage() {
  const ctx = await requireSellerPage("/dashboard/staff", "staff.manage");
  const now = new Date();
  const { staff, invitations } = await withSellerRls(ctx, async (tx) => ({
    staff: await tx.businessStaff.findMany({
      where: { businessId: ctx.business.id },
      orderBy: { acceptedAt: "asc" },
      select: { id: true, permissions: true, acceptedAt: true, user: { select: { name: true, email: true, lastLoginAt: true } } },
    }),
    invitations: await tx.staffInvitation.findMany({
      where: { businessId: ctx.business.id, acceptedAt: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true, email: true, permissions: true, expiresAt: true, createdAt: true },
    }),
  }));

  return (
    <>
      <PageHeader title="Staff" description="People who help run your store. Each sees only the parts you give them." />
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your team</CardTitle>
          </CardHeader>
          <CardContent>
            {staff.length === 0 ? (
              <p className="text-sm text-muted-foreground">Just you for now. Invite someone below.</p>
            ) : (
              <ul className="flex flex-col divide-y">
                {staff.map((s) => {
                  const flags = (s.permissions ?? {}) as Record<string, boolean>;
                  const name = s.user.name ?? s.user.email;
                  return (
                    <li key={s.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{name}</p>
                          <p className="text-xs text-muted-foreground">
                            {s.user.email} · joined {s.acceptedAt ? formatDate(s.acceptedAt) : "–"}
                            {s.user.lastLoginAt && ` · last signed in ${formatDate(s.user.lastLoginAt)}`}
                          </p>
                        </div>
                        <span className="flex flex-wrap gap-1">
                          {access(flags).length ? access(flags).map((a) => <Badge key={a} variant="secondary">{a}</Badge>) : <Badge variant="warning">No access</Badge>}
                        </span>
                      </div>
                      <StaffMemberControls staffId={s.id} name={name} initial={flags} />
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {invitations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Waiting to accept</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y">
                {invitations.map((i) => {
                  const expired = i.expiresAt <= now;
                  return (
                    <li key={i.id} className="flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div>
                        <p className="font-medium">{i.email}</p>
                        <p className="text-xs text-muted-foreground">
                          {access(i.permissions as Record<string, boolean>).join(", ")} · {expired ? <span className="text-danger">link expired</span> : `link works until ${formatDateTime(i.expiresAt)}`}
                        </p>
                      </div>
                      <InvitationControls invitationId={i.id} />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Invite someone</CardTitle>
            <CardDescription>They get an email with a link. They sign in or create a TownMart account with that email, then accept.</CardDescription>
          </CardHeader>
          <CardContent>
            <InviteStaffForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
