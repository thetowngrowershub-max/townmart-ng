import { CircleAlert, CircleCheck, CircleMinus } from "lucide-react";
import type { Metadata } from "next";
import { RetryAllButton, RetryJobButton } from "@/components/admin/job-retry";
import { PageHeader } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/current-user";
import { can } from "@/lib/authz";
import { formatDateTime } from "@/lib/datetime";
import { databaseStats, longRunningQueries, opsAndJobs, queueStats, slowQueries, type Section } from "@/lib/system/health";

export const metadata: Metadata = { title: "System health" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;

function bytes(n: bigint | number | null) {
  if (n === null) return "–";
  const v = Number(n);
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(Math.max(v, 1)) / Math.log(1024)));
  return `${(v / 1024 ** i).toLocaleString("en-NG", { maximumFractionDigits: i ? 1 : 0 })} ${units[i]}`;
}

function ago(d: Date) {
  const h = Math.round((Date.now() - d.getTime()) / 3_600_000);
  return h < 1 ? "less than an hour ago" : h < 48 ? `${h} hour${h === 1 ? "" : "s"} ago` : `${Math.round(h / 24)} days ago`;
}

type Tone = "good" | "warn" | "bad" | "none";
function Status({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const Icon = tone === "good" ? CircleCheck : tone === "none" ? CircleMinus : CircleAlert;
  const color = tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : tone === "bad" ? "text-danger" : "text-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Icon className={`size-4 shrink-0 ${color}`} aria-hidden />
      {children}
    </span>
  );
}

function Unavailable({ s }: { s: Section<unknown> }) {
  return s.ok ? null : <p className="text-sm text-muted-foreground">Unavailable: {s.reason}</p>;
}

function Tile({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-heading text-2xl font-bold tabular-nums">{value}</p>
      {children}
    </Card>
  );
}

export default async function SystemHealthPage() {
  const user = await requirePermission("system_health.view", "/admin/system");
  const canRetry = can(user, "jobs.retry");
  const [db, longRunning, slow, queues, ops] = await Promise.all([databaseStats(), longRunningQueries(), slowQueries(), queueStats(), opsAndJobs(user.id)]);

  const backupTone = (e: { succeeded: boolean; finishedAt: Date } | null | undefined, maxDays: number): Tone => (!e ? "none" : !e.succeeded ? "bad" : Date.now() - e.finishedAt.getTime() > maxDays * DAY ? "warn" : "good");
  const connPct = db.ok ? Math.round((db.data.connections / db.data.maxConnections) * 100) : 0;
  const failedTotal = queues.ok ? queues.data.reduce((a, q) => a + q.counts.failed!, 0) : 0;

  return (
    <>
      <PageHeader title="System health" description="Database, backups, background jobs and queues. Figures are live when the page loads." />
      <div className="flex flex-col gap-6">
        <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <li>
            <Tile label="Database size" value={db.ok ? bytes(db.data.sizeBytes) : "–"}>
              <Unavailable s={db} />
            </Tile>
          </li>
          <li>
            <Tile label="Connections" value={db.ok ? `${db.data.connections} / ${db.data.maxConnections}` : "–"}>
              {db.ok && <Status tone={connPct >= 80 ? "bad" : connPct >= 60 ? "warn" : "good"}>{connPct}% of the limit</Status>}
            </Tile>
          </li>
          <li>
            <Tile label="Last backup" value={ops.ok && ops.data.backup ? ago(ops.data.backup.finishedAt) : "None recorded"}>
              {ops.ok && (
                <Status tone={backupTone(ops.data.backup, 1)}>
                  {!ops.data.backup ? "No backup has been recorded yet" : ops.data.backup.succeeded ? `Succeeded · ${bytes(ops.data.backup.sizeBytes)}` : `Failed. Last good: ${ops.data.backupOk ? formatDateTime(ops.data.backupOk.finishedAt) : "never"}`}
                </Status>
              )}
            </Tile>
          </li>
          <li>
            <Tile label="Last restore test" value={ops.ok && ops.data.restore ? ago(ops.data.restore.finishedAt) : "None recorded"}>
              {ops.ok && (
                <Status tone={backupTone(ops.data.restore, 31)}>
                  {!ops.data.restore ? "Test a restore at least monthly" : ops.data.restore.succeeded ? "Restored and checked" : `Failed. Last good: ${ops.data.restoreOk ? formatDateTime(ops.data.restoreOk.finishedAt) : "never"}`}
                </Status>
              )}
            </Tile>
          </li>
        </ul>

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle>Queues</CardTitle>
              <CardDescription>Jobs waiting, running and failed in each background queue.</CardDescription>
            </div>
            {queues.ok && <Status tone={failedTotal ? "bad" : "good"}>{failedTotal ? `${failedTotal} failed` : "Nothing failed"}</Status>}
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <Unavailable s={queues} />
            {queues.ok && (
              <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label="Queue counts">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="border-b text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Queue</th>
                      {["Waiting", "Running", "Delayed", "Failed"].map((h) => (
                        <th key={h} className="py-2 pr-4 text-right font-medium">
                          {h}
                        </th>
                      ))}
                      <th className="py-2">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {queues.data.map((q) => (
                      <tr key={q.name}>
                        <td className="py-2 pr-4 font-medium">{q.name}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{(q.counts.waiting ?? 0) + (q.counts.prioritized ?? 0)}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{q.counts.active}</td>
                        <td className="py-2 pr-4 text-right tabular-nums">{q.counts.delayed}</td>
                        <td className={`py-2 pr-4 text-right tabular-nums ${q.counts.failed ? "font-semibold text-danger" : ""}`}>{q.counts.failed}</td>
                        <td className="py-2 text-right">{canRetry && q.counts.failed! > 0 && <RetryAllButton queue={q.name} count={q.counts.failed!} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {queues.ok && failedTotal > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Failed jobs</h3>
                <ul className="flex flex-col divide-y rounded-xl border">
                  {queues.data.flatMap((q) =>
                    q.failed.map((j) => (
                      <li key={`${q.name}-${j.id}`} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">
                            {q.name} · <span className="font-mono text-xs">{j.name}</span>
                          </p>
                          <p className="text-xs break-words text-danger">{j.reason || "No reason given"}</p>
                          <p className="text-xs text-muted-foreground">
                            {j.attempts} attempt{j.attempts === 1 ? "" : "s"}
                            {j.failedAt && ` · last ${formatDateTime(j.failedAt)}`}
                          </p>
                        </div>
                        {canRetry && <RetryJobButton queue={q.name} jobId={j.id} />}
                      </li>
                    )),
                  )}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled jobs</CardTitle>
              <CardDescription>The latest run of each job, and failures in the last 7 days.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Unavailable s={ops} />
              {ops.ok && ops.data.latestRuns.length === 0 && <p className="text-sm text-muted-foreground">No job has run yet. Is the worker running?</p>}
              {ops.ok && ops.data.latestRuns.length > 0 && (
                <ul className="flex flex-col divide-y text-sm">
                  {ops.data.latestRuns.map((r) => (
                    <li key={r.job_name} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-mono text-xs">{r.job_name}</span>
                      <Status tone={r.status === "succeeded" ? "good" : r.status === "failed" ? "bad" : "warn"}>
                        {r.status === "running" ? "Running since" : r.status === "failed" ? "Failed" : "OK"} {formatDateTime(r.finished_at ?? r.started_at)}
                      </Status>
                    </li>
                  ))}
                </ul>
              )}
              {ops.ok && ops.data.failures.length > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer font-medium text-danger">
                    {ops.data.failures.length} failure{ops.data.failures.length === 1 ? "" : "s"} this week
                  </summary>
                  <ul className="mt-2 flex flex-col gap-2">
                    {ops.data.failures.map((f) => (
                      <li key={f.id} className="rounded-lg bg-muted p-2 text-xs">
                        <span className="font-mono">{f.jobName}</span> · {formatDateTime(f.startedAt)}
                        {f.error && <span className="block break-words text-muted-foreground">{f.error.slice(0, 300)}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Largest tables</CardTitle>
              <CardDescription>Including indexes. Row counts are Postgres estimates.</CardDescription>
            </CardHeader>
            <CardContent>
              <Unavailable s={db} />
              {db.ok && (
                <ul className="flex flex-col divide-y text-sm">
                  {db.data.tables.map((t) => (
                    <li key={t.name} className="flex justify-between gap-3 py-2">
                      <span className="font-mono text-xs">{t.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {bytes(t.bytes)} · ~{t.rows.toLocaleString("en-NG")} rows
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {db.ok && (
                <p className="mt-4 text-xs text-muted-foreground">Connections now: {db.data.byState.map((s) => `${s.count} ${s.state}`).join(", ")}.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Slow queries</CardTitle>
            <CardDescription>Slowest on average since statistics were last reset, from pg_stat_statements.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {!slow.ok && <p className="text-sm text-muted-foreground">Not available here{slow.reason ? `: ${slow.reason}` : ""}. Production loads pg_stat_statements (see DATABASE.md).</p>}
            {slow.ok && slow.data.length === 0 && <p className="text-sm text-muted-foreground">No statistics yet.</p>}
            {slow.ok && slow.data.length > 0 && (
              <ul className="flex flex-col divide-y text-sm">
                {slow.data.map((q, i) => (
                  <li key={i} className="flex flex-col gap-1 py-2">
                    <code className="text-xs break-all">{q.query}</code>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {q.mean_ms.toLocaleString("en-NG")} ms average · {q.calls.toLocaleString("en-NG")} calls · {Math.round(q.total_ms / 1000).toLocaleString("en-NG")} s total
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Running for more than 5 seconds</h3>
              <Unavailable s={longRunning} />
              {longRunning.ok && longRunning.data.length === 0 && <Status tone="good">Nothing</Status>}
              {longRunning.ok && longRunning.data.length > 0 && (
                <ul className="flex flex-col divide-y text-sm">
                  {longRunning.data.map((q) => (
                    <li key={q.pid} className="flex flex-col gap-1 py-2">
                      <code className="text-xs break-all">{q.query ?? "(hidden: another role's query)"}</code>
                      <span className="text-xs text-muted-foreground">
                        {q.seconds} s · {q.state} · pid {q.pid}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
