import "server-only";
import { Queue } from "bullmq";
import { prisma, withRls } from "@/lib/db";
import { logger } from "@/lib/logger";
import { QUEUES } from "@/lib/queue";
import { redis } from "@/lib/redis";

/**
 * Figures for the admin system health page. Each section fails on its own:
 * a Redis outage or a missing pg_stat_statements shows as "unavailable"
 * rather than breaking the page.
 */

export type Section<T> = { ok: true; data: T } | { ok: false; reason: string };

async function section<T>(name: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    logger.warn({ err, section: name }, "system health section unavailable");
    return { ok: false, reason: (err instanceof Error && err.message.split("\n").map((l) => l.trim()).filter(Boolean).at(-1)?.slice(0, 200)) || "Unavailable" };
  }
}

const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`No answer within ${ms / 1000}s`)), ms))]);

// Database statistics views aren't RLS tables; these run outside a transaction
// so one failing view (pg_stat_statements not loaded) can't abort the others.

export function databaseStats() {
  return section("database", async () => {
    const [size] = await prisma.$queryRaw<{ bytes: bigint; max: number }[]>`
      SELECT pg_database_size(current_database()) AS bytes, current_setting('max_connections')::int AS max`;
    const states = await prisma.$queryRaw<{ state: string | null; n: bigint }[]>`
      SELECT state, count(*) AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY state`;
    const tables = await prisma.$queryRaw<{ name: string; bytes: bigint; rows: bigint }[]>`
      SELECT c.relname AS name, pg_total_relation_size(c.oid) AS bytes, GREATEST(c.reltuples, 0)::bigint AS rows
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 8`;
    const connections = states.reduce((a, s) => a + Number(s.n), 0);
    return {
      sizeBytes: size!.bytes,
      maxConnections: size!.max,
      connections,
      byState: states.map((s) => ({ state: s.state ?? "background", count: Number(s.n) })).sort((a, b) => b.count - a.count),
      tables: tables.map((t) => ({ name: t.name, bytes: t.bytes, rows: Number(t.rows) })),
    };
  });
}

/** Queries running for more than 5 seconds, oldest first. Postgres shows other roles' query text only to privileged roles. */
export function longRunningQueries() {
  return section("long-running", async () => {
    const rows = await prisma.$queryRaw<{ pid: number; seconds: number; state: string | null; query: string | null }[]>`
      SELECT pid, EXTRACT(EPOCH FROM now() - query_start)::int AS seconds, state, left(query, 300) AS query
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid() AND state <> 'idle' AND query_start < now() - interval '5 seconds'
      ORDER BY query_start LIMIT 10`;
    return rows;
  });
}

/** Slowest statements by average time, from pg_stat_statements (needs shared_preload_libraries). */
export function slowQueries() {
  return section("slow-queries", async () => {
    const rows = await prisma.$queryRaw<{ query: string; calls: bigint; mean_ms: number; total_ms: number }[]>`
      SELECT left(regexp_replace(query, '\\s+', ' ', 'g'), 300) AS query, calls, round(mean_exec_time::numeric, 1)::float AS mean_ms, round(total_exec_time::numeric)::float AS total_ms
      FROM pg_stat_statements
      WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database()) AND calls > 0
      ORDER BY mean_exec_time DESC LIMIT 10`;
    return rows.map((r) => ({ ...r, calls: Number(r.calls) }));
  });
}

const globalForAdminQueues = globalThis as unknown as { adminQueues?: Map<string, Queue> };

/** Read-only handles on every queue, for counts and retries. They share the app's Redis connection. */
export function adminQueue(name: string): Queue {
  globalForAdminQueues.adminQueues ??= new Map();
  let q = globalForAdminQueues.adminQueues.get(name);
  if (!q) {
    q = new Queue(name, { connection: redis });
    globalForAdminQueues.adminQueues.set(name, q);
  }
  return q;
}

export const QUEUE_NAMES = Object.values(QUEUES);

export function queueStats() {
  return section("queues", () =>
    withTimeout(
      Promise.all(
        QUEUE_NAMES.map(async (name) => {
          const q = adminQueue(name);
          const [counts, failed] = await Promise.all([q.getJobCounts("waiting", "active", "delayed", "failed", "prioritized"), q.getFailed(0, 9)]);
          return {
            name,
            counts,
            failed: failed.map((j) => ({ id: j.id ?? "", name: j.name, reason: (j.failedReason ?? "").slice(0, 300), attempts: j.attemptsMade, failedAt: j.finishedOn ? new Date(j.finishedOn) : null })),
          };
        }),
      ),
      4000,
    ),
  );
}

/** Backups and restore tests recorded by the ops scripts (pnpm ops:record), and recent background job runs. */
export function opsAndJobs(userId: string) {
  return section("ops", () =>
    withRls({ scope: "admin", userId }, async (tx) => {
      const last = (kind: "backup" | "restore_test", succeeded?: boolean) => tx.opsEvent.findFirst({ where: { kind, ...(succeeded === undefined ? {} : { succeeded }) }, orderBy: { finishedAt: "desc" } });
      const [backup, backupOk, restore, restoreOk, latestRuns, failures] = await Promise.all([
        last("backup"),
        last("backup", true),
        last("restore_test"),
        last("restore_test", true),
        tx.$queryRaw<{ job_name: string; status: string; started_at: Date; finished_at: Date | null; error: string | null }[]>`
          SELECT DISTINCT ON (job_name) job_name, status::text, started_at, finished_at, left(error, 300) AS error
          FROM job_runs ORDER BY job_name, started_at DESC`,
        tx.jobRun.findMany({ where: { status: "failed", startedAt: { gte: new Date(Date.now() - 7 * 86_400_000) } }, orderBy: { startedAt: "desc" }, take: 10 }),
      ]);
      return { backup, backupOk, restore, restoreOk, latestRuns, failures };
    }),
  );
}
