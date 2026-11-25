import type { Metadata } from "next";
import Link from "next/link";
import { MarkReadButton } from "@/components/account/mark-read-button";
import { NotificationPreferences } from "@/components/account/notification-preferences";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime } from "@/lib/datetime";
import { withRls } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requirePermission("account.access", "/account/notifications");
  const { notes, prefs } = await withRls({ userId: user.id }, async (tx) => ({
    notes: await tx.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prefs: await tx.notificationPreference.findUnique({ where: { userId: user.id } }),
  }));
  const unread = notes.some((n) => !n.readAt);
  return (
    <>
      <PageHeader title="Notifications" description="Order updates and messages from TownMart." actions={unread ? <MarkReadButton /> : undefined} />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>What we send you</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferences
            initial={{
              smsOrderUpdates: prefs?.smsOrderUpdates ?? true,
              smsBookingReminders: prefs?.smsBookingReminders ?? true,
              emailMessages: prefs?.emailMessages ?? true,
              marketingEmail: prefs?.marketingEmail ?? false,
              marketingSms: prefs?.marketingSms ?? false,
            }}
          />
        </CardContent>
      </Card>
      {notes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-muted-foreground">Nothing yet. Order updates will appear here.</CardContent>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((n) => {
            const body = (
              <>
                <p className="flex items-center gap-2 font-medium">
                  {!n.readAt && <span className="size-2 rounded-full bg-primary" aria-label="Unread" />}
                  {n.title}
                </p>
                <p className="text-sm text-muted-foreground">{n.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p>
              </>
            );
            const cls = cn("block rounded-2xl border bg-card p-4", !n.readAt && "border-primary/40");
            return (
              <li key={n.id}>
                {n.link ? (
                  <Link href={n.link} className={cn(cls, "hover:border-primary")}>
                    {body}
                  </Link>
                ) : (
                  <div className={cls}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
