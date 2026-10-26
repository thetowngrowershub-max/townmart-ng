import { prisma } from "@/lib/db";

/**
 * Records each job execution in `job_runs` so the admin health page can show
 * last success/failure. `job_runs` isn't RLS-protected, so no context is needed.
 */
export async function trackJobRun<T>(jobName: string, fn: () => Promise<T>): Promise<T> {
  const run = await prisma.jobRun.create({ data: { jobName }, select: { id: true } });
  try {
    const result = await fn();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "succeeded", finishedAt: new Date(), meta: result === undefined ? undefined : (result as object) },
    });
    return result;
  } catch (err) {
    await prisma.jobRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), error: err instanceof Error ? err.message.slice(0, 2000) : String(err) },
    });
    throw err;
  }
}
