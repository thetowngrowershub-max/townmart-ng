"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/current-user";
import { withRls, withSystemContext } from "@/lib/db";
import { logger } from "@/lib/logger";
import { bankVerifier } from "@/lib/payments/banks";
import { RIDER_PAYOUT_BLOCK_TEXT, requestPayoutFor } from "@/lib/payouts/payouts";
import { rateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/request";
import { getPoolRider } from "@/lib/riders/pool";
import { validationError, type ActionResult } from "@/lib/validation/form-result";
import { payoutAccountSchema, type PayoutAccountInput } from "@/lib/validation/seller";

/**
 * A TownMart pool rider's wallet: their bank account and payout requests.
 * Each action checks the signed-in user is an approved pool rider; the bank
 * account and payout rows are written in the system scope (they have no shop,
 * so shop RLS doesn't cover them).
 */

class WalletError extends Error {}
const TOO_MANY = "Too many attempts. Please wait a few minutes and try again.";

async function poolRider() {
  const user = await getCurrentUser();
  if (!user) throw new WalletError("Please sign in first.");
  const rider = await withRls({ userId: user.id }, (tx) => getPoolRider(tx, user.id));
  if (!rider) throw new WalletError("Your rider wallet opens once TownMart approves you as a rider.");
  return { user, rider };
}

function failure(err: unknown, fallback = "Something went wrong. Please try again."): ActionResult<never> {
  if (err instanceof WalletError) return { ok: false, error: err.message };
  logger.error({ err }, "rider wallet action failed");
  return { ok: false, error: fallback };
}

export async function resolveRiderBankAction(input: PayoutAccountInput): Promise<ActionResult<{ accountName: string }>> {
  const parsed = payoutAccountSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  try {
    const { user } = await poolRider();
    if (!(await rateLimit(`bank-resolve:${user.id}`, 10, 600)).allowed) return { ok: false, error: TOO_MANY };
    const res = await bankVerifier().resolveAccount(parsed.data.bankCode, parsed.data.accountNumber);
    if (!res) return { ok: false, error: "We couldn't find that account. Check the bank and number.", fieldErrors: { accountNumber: ["Account not found"] } };
    return { ok: true, data: res };
  } catch (err) {
    return failure(err, "We couldn't reach the bank right now. Please try again shortly.");
  }
}

export async function saveRiderBankAction(input: PayoutAccountInput): Promise<ActionResult> {
  const parsed = payoutAccountSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const { bankCode, accountNumber } = parsed.data;
  try {
    const { user, rider } = await poolRider();
    if (!(await rateLimit(`bank-save:${rider.id}`, 5, 3600)).allowed) throw new WalletError(TOO_MANY);
    const verifier = bankVerifier();
    // Resolve again on the server: never trust an account name sent by the browser.
    const resolved = await verifier.resolveAccount(bankCode, accountNumber);
    if (!resolved) throw new WalletError("We couldn't find that account. Check the bank and number.");
    const bank = (await verifier.listBanks()).find((b) => b.code === bankCode);
    if (!bank) throw new WalletError("Choose your bank from the list.");
    const recipient = await verifier.createTransferRecipient({ accountName: resolved.accountName, bankCode, accountNumber });
    const data = {
      bankCode,
      bankName: bank.name,
      accountNumberLast4: accountNumber.slice(-4),
      accountName: resolved.accountName,
      providerRecipientCode: recipient.recipientCode,
      recipientProvider: verifier.name,
      verifiedAt: new Date(),
    };
    const meta = await requestMeta();
    await withSystemContext(async (tx) => {
      await tx.payoutAccount.upsert({ where: { riderId: rider.id }, create: { ...data, riderId: rider.id }, update: data });
      await writeAudit(tx, { actorUserId: user.id, action: "payout_account.saved", entityType: "rider", entityId: rider.id, after: { bankName: bank.name, last4: data.accountNumberLast4 }, ipHash: meta.ipHash });
    });
  } catch (err) {
    return failure(err, "We couldn't save your account right now. Please try again shortly.");
  }
  revalidatePath("/rider/wallet");
  return { ok: true };
}

/** The rider asks for their whole wallet balance. */
export async function requestRiderPayoutAction(): Promise<ActionResult> {
  try {
    const { user, rider } = await poolRider();
    if (!(await rateLimit(`payout:${rider.id}`, 5, 3600)).allowed) return { ok: false, error: "You've asked a few times already. Please wait a while." };
    const res = await requestPayoutFor({ kind: "rider", id: rider.id }, user.id);
    revalidatePath("/rider/wallet");
    if (typeof res === "string") return { ok: false, error: RIDER_PAYOUT_BLOCK_TEXT[res] };
    const said: Record<string, string> = {
      awaiting_approval: "Asked. TownMart checks each payout first, usually within a working day; we'll text you when it's sent.",
      paid: "Sent to your bank.",
      processing: "On its way to your bank.",
      pending: "Starting. We'll text you when it's sent.",
    };
    if (res.status === "failed") return { ok: false, error: "The transfer didn't go through, so the money is back in your wallet. Check your bank account." };
    return { ok: true, message: said[res.status] ?? "Asked." };
  } catch (err) {
    return failure(err);
  }
}
