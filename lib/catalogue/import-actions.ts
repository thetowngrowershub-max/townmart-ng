"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeAudit } from "@/lib/audit";
import { assertCan, AuthzError } from "@/lib/authz";
import { logger } from "@/lib/logger";
import { enqueueProductImport } from "@/lib/queue";
import { rateLimit } from "@/lib/rate-limit";
import { getSellerContext, withSellerRls } from "@/lib/seller/context";
import { finaliseCsv, UploadError } from "@/lib/storage/uploads";
import type { ActionResult } from "@/lib/validation/form-result";

const schema = z.object({ tmpKey: z.string().max(200), fileName: z.string().trim().min(1).max(200) });

/** Moves the uploaded CSV into place, records an import job and queues it for the worker. */
export async function startProductImportAction(input: z.input<typeof schema>): Promise<ActionResult<{ id: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a CSV file to import." };
  try {
    const ctx = await getSellerContext();
    if (!ctx) throw new AuthzError(401);
    assertCan(ctx.user, "import.manage", { businessId: ctx.business.id });
    if (!(await rateLimit(`import:${ctx.business.id}`, 10, 3600)).allowed) return { ok: false, error: "You've started a lot of imports. Please wait a while." };

    const fileKey = await finaliseCsv(ctx.business.id, parsed.data.tmpKey);
    const job = await withSellerRls(ctx, async (tx) => {
      const j = await tx.importJob.create({
        data: { businessId: ctx.business.id, fileKey, fileName: parsed.data.fileName.replace(/[^\w .()-]/g, "_"), createdBy: ctx.user.id },
        select: { id: true },
      });
      await writeAudit(tx, { actorUserId: ctx.user.id, action: "product.import_started", entityType: "import_job", entityId: j.id });
      return j;
    });
    await enqueueProductImport({ importJobId: job.id, businessId: ctx.business.id });
    revalidatePath("/dashboard/products/import");
    return { ok: true, data: { id: job.id } };
  } catch (err) {
    if (err instanceof AuthzError || err instanceof UploadError) return { ok: false, error: err.message };
    logger.error({ err }, "start import failed");
    return { ok: false, error: "Couldn't start the import. Please try again." };
  }
}
