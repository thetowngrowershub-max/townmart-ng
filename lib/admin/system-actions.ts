"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminContext, AdminError, adminFailure } from "@/lib/admin/context";
import { QUEUES } from "@/lib/queue";
import { adminQueue } from "@/lib/system/health";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

/** Retrying failed background jobs from the system health page. Each retry is audited. */

const queueName = z.enum(Object.values(QUEUES) as [string, ...string[]]);
const retrySchema = z.object({ queue: queueName, jobId: z.string().min(1).max(200) });
const retryAllSchema = z.object({ queue: queueName });

export async function retryJobAction(input: z.input<typeof retrySchema>): Promise<ActionResult> {
  const parsed = retrySchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { queue, jobId } = parsed.data;
  try {
    const { run } = await adminContext("jobs.retry");
    const job = await adminQueue(queue).getJob(jobId);
    if (!job || !(await job.isFailed())) throw new AdminError("That job isn't waiting for a retry any more.");
    await job.retry("failed");
    await run((_tx, audit) => audit("job.retried", "queue_job", `${queue}:${jobId}`, { name: job.name }));
    revalidatePath("/admin/system");
    return { ok: true, message: "Job queued to run again." };
  } catch (err) {
    return adminFailure(err, "job retry");
  }
}

export async function retryAllFailedAction(input: z.input<typeof retryAllSchema>): Promise<ActionResult> {
  const parsed = retryAllSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { queue } = parsed.data;
  try {
    const { run } = await adminContext("jobs.retry");
    const q = adminQueue(queue);
    const n = await q.getFailedCount();
    if (n === 0) throw new AdminError("Nothing has failed in this queue.");
    await q.retryJobs({ state: "failed", count: 1000 });
    await run((_tx, audit) => audit("job.retried_all", "queue", queue, { count: n }));
    revalidatePath("/admin/system");
    return { ok: true, message: `${n} job${n === 1 ? "" : "s"} queued to run again.` };
  } catch (err) {
    return adminFailure(err, "job retry");
  }
}
