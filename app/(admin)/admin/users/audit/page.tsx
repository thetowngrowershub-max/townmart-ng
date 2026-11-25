import type { Prisma } from "@prisma/client";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/layout/app-shell";
import { Pagination } from "@/components/storefront/pagination";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requirePermission } from "@/lib/auth/current-user";
import { formatDateTime, lagosLocalToDate } from "@/lib/datetime";
import { withRls } from "@/lib/db";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;
type SP = { actor?: string; action?: string; entity?: string; id?: string; from?: string; to?: string; page?: string };

const day = (v: string | undefined, end: boolean) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined;
  const d = lagosLocalToDate(`${v}T${end ? "23:59:59" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs whitespace-pre-wrap break-all">{JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}

/** Read-only by design: the table is append-only in the database, and nothing here can change it. */
export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("audit_log.read", "/admin/users/audit");
  const sp = await searchParams;
  const f = { actor: (sp.actor ?? "").trim().slice(0, 200), action: (sp.action ?? "").trim().slice(0, 80), entity: (sp.entity ?? "").trim().slice(0, 60), id: (sp.id ?? "").trim().slice(0, 100), from: sp.from ?? "", to: sp.to ?? "" };
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const data = await withRls({ scope: "admin", userId: user.id }, async (tx) => {
    const actors = f.actor ? await tx.user.findMany({ where: { email: { contains: f.actor, mode: "insensitive" } }, select: { id: true }, take: 50 }) : null;
    const from = day(f.from, false);
    const to = day(f.to, true);
    const where: Prisma.AuditLogWhereInput = {
      ...(actors ? { actorUserId: { in: actors.map((a) => a.id) } } : {}),
      ...(f.action ? { action: { contains: f.action } } : {}),
      ...(f.entity ? { entityType: f.entity } : {}),
      ...(f.id ? { entityId: f.id } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([tx.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }), tx.auditLog.count({ where })]);
    const people = await tx.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])))] } }, select: { id: true, email: true } });
    return { rows, total, emails: new Map(people.map((p) => [p.id, p.email])) };
  });
  const qs = (n: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)), page: String(n) }).toString();

  return (
    <>
      <PageHeader title="Audit log" description={`${data.total.toLocaleString("en-NG")} entr${data.total === 1 ? "y" : "ies"}. Every change made by staff, sellers and the system. Entries can't be edited or deleted.`} />
      <form className="mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6" role="search">
        {(
          [
            ["actor", "Who (email)", "text"],
            ["action", "Action contains", "text"],
            ["entity", "Entity type", "text"],
            ["id", "Entity id", "text"],
            ["from", "From", "date"],
            ["to", "To", "date"],
          ] as const
        ).map(([k, l, t]) => (
          <div key={k} className="flex flex-col gap-1">
            <label htmlFor={`f-${k}`} className="text-xs text-muted-foreground">
              {l}
            </label>
            <Input id={`f-${k}`} name={k} type={t} defaultValue={f[k]} />
          </div>
        ))}
        <div className="flex gap-2 sm:col-span-3 lg:col-span-6">
          <Button type="submit" size="sm" variant="outline">
            Filter
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link href="/admin/users/audit">Clear</Link>
          </Button>
        </div>
      </form>
      <Card className="divide-y p-0">
        {data.rows.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted-foreground">No entries match.</p>}
        {data.rows.map((r) => (
          <details key={r.id} className="group">
            <summary className="grid cursor-pointer gap-1 px-4 py-3 text-sm hover:bg-muted/40 sm:grid-cols-[11rem_1fr_1fr_14rem] sm:gap-4">
              <span className="text-xs text-muted-foreground tabular-nums">{formatDateTime(r.createdAt)}</span>
              <span className="font-mono text-xs break-all">{r.action}</span>
              <span className="text-xs break-all">
                {r.entityType}
                {r.entityId && <span className="text-muted-foreground"> · {r.entityId}</span>}
              </span>
              <span className="truncate text-xs">
                {r.actorUserId ? (data.emails.get(r.actorUserId) ?? "Deleted account") : "System"}
                {r.actorRole && <span className="text-muted-foreground"> · {r.actorRole.replace("_", " ")}</span>}
              </span>
            </summary>
            <div className="flex flex-col gap-3 px-4 pb-4 sm:flex-row">
              <Json label="Before" value={r.before} />
              <Json label="After" value={r.after} />
              {r.before === null && r.after === null && <p className="text-xs text-muted-foreground">No details recorded.</p>}
            </div>
          </details>
        ))}
      </Card>
      <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} href={(n) => `/admin/users/audit?${qs(n)}`} />
    </>
  );
}
