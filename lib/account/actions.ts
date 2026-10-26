"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/current-user";
import { encrypt } from "@/lib/crypto";
import { withRls } from "@/lib/db";
import { newAddressSchema } from "@/lib/validation/checkout";
import { validationError, type ActionResult } from "@/lib/validation/form-result";

const idSchema = z.object({ id: z.uuid() });
const MAX_ADDRESSES = 10;

export async function addAddressAction(input: z.input<typeof newAddressSchema>): Promise<ActionResult> {
  const user = await requirePermission("account.access", "/account/addresses");
  const parsed = newAddressSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const a = parsed.data;
  const res = await withRls({ userId: user.id }, async (tx) => {
    const count = await tx.address.count({ where: { userId: user.id } });
    if (count >= MAX_ADDRESSES) return { ok: false as const, error: `You can save up to ${MAX_ADDRESSES} addresses. Remove one first.` };
    const lga = await tx.lga.findFirst({ where: { id: a.lgaId, stateId: a.stateId }, select: { id: true } });
    if (!lga) return { ok: false as const, error: "Please check the highlighted fields.", fieldErrors: { lgaId: ["Choose an LGA in the selected state"] } };
    await tx.address.create({
      data: {
        userId: user.id,
        recipientName: a.recipientName,
        phoneEncrypted: encrypt(a.phone),
        line1Encrypted: encrypt(a.line1),
        line2Encrypted: a.line2 ? encrypt(a.line2) : null,
        landmark: a.landmark || null,
        city: a.city,
        stateId: a.stateId,
        lgaId: a.lgaId,
        isDefault: count === 0,
      },
    });
    return { ok: true as const };
  });
  revalidatePath("/account/addresses");
  return res;
}

export async function deleteAddressAction(input: { id: string }): Promise<ActionResult> {
  const user = await requirePermission("account.access", "/account/addresses");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  await withRls({ userId: user.id }, async (tx) => {
    const target = await tx.address.findFirst({ where: { id: parsed.data.id, userId: user.id }, select: { id: true, isDefault: true } });
    if (!target) return;
    await tx.address.delete({ where: { id: target.id } });
    // Removing the default promotes the most recently used address.
    if (target.isDefault) {
      const next = await tx.address.findFirst({ where: { userId: user.id }, orderBy: { updatedAt: "desc" }, select: { id: true } });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
  revalidatePath("/account/addresses");
  return { ok: true };
}

export async function setDefaultAddressAction(input: { id: string }): Promise<ActionResult> {
  const user = await requirePermission("account.access", "/account/addresses");
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  await withRls({ userId: user.id }, async (tx) => {
    const target = await tx.address.findFirst({ where: { id: parsed.data.id, userId: user.id }, select: { id: true } });
    if (!target) return;
    await tx.address.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
    await tx.address.update({ where: { id: target.id }, data: { isDefault: true } });
  });
  revalidatePath("/account/addresses");
  return { ok: true };
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  const user = await requirePermission("account.access", "/account/notifications");
  await withRls({ userId: user.id }, (tx) => tx.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } }));
  revalidatePath("/account/notifications");
  return { ok: true };
}
