/**
 * Records a backup or restore test in ops_events so the admin system health
 * page can show it. Called by the backup and restore-test scripts:
 *
 *   pnpm ops:record backup --ok --started 2026-10-30T01:00:00Z --size 123456789 --note "nightly"
 *   pnpm ops:record restore_test --failed --started … --note "row counts differ"
 *
 * Exits non-zero if the row can't be written, so a cron wrapper notices.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma, withSystemContext } from "@/lib/db";

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      ok: { type: "boolean" },
      failed: { type: "boolean" },
      started: { type: "string" },
      size: { type: "string" },
      note: { type: "string" },
    },
  });

  const kind = positionals[0];
  if (kind !== "backup" && kind !== "restore_test") throw new Error("First argument must be backup or restore_test");
  if (values.ok === values.failed) throw new Error("Pass exactly one of --ok or --failed");
  const finishedAt = new Date();
  const startedAt = values.started ? new Date(values.started) : finishedAt;
  if (Number.isNaN(startedAt.getTime()) || startedAt > finishedAt) throw new Error("--started must be an ISO time in the past");
  if (values.size !== undefined && !/^\d+$/.test(values.size)) throw new Error("--size must be a whole number of bytes");

  await withSystemContext((tx) =>
    tx.opsEvent.create({
      data: {
        kind,
        succeeded: Boolean(values.ok),
        startedAt,
        finishedAt,
        sizeBytes: values.size === undefined ? null : BigInt(values.size),
        details: values.note ? { note: values.note.slice(0, 500) } : undefined,
      },
    }),
  );
  console.log(`Recorded ${kind} (${values.ok ? "ok" : "failed"})`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
