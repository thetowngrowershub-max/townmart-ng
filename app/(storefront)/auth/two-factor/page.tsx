import type { Metadata } from "next";
import Link from "next/link";
import { TwoFactorForm, type FactorOption } from "@/components/auth/two-factor-form";
import { Alert } from "@/components/ui/alert";
import { readPendingTwoFactor } from "@/lib/auth/two-factor";
import { FACTOR_LABELS, factorsFor, isTwoFactorOn, loadTwoFactorUser } from "@/lib/auth/two-factor-methods";
import { decryptNullable } from "@/lib/crypto";
import { maskEmail, maskPhone } from "@/lib/phone";
import { AuthCard } from "../auth-card";

export const metadata: Metadata = { title: "Two-step sign-in", robots: { index: false } };

export default async function TwoFactorPage() {
  const pending = await readPendingTwoFactor();
  const user = pending ? await loadTwoFactorUser(pending.userId) : null;
  const factors = user && pending && isTwoFactorOn(user) ? factorsFor(user, pending.via) : [];
  const phone = decryptNullable(user?.phoneEncrypted);
  const options: FactorOption[] = factors.map((factor) => ({
    factor,
    label: FACTOR_LABELS[factor],
    hint:
      factor === "sms" && phone
        ? maskPhone(phone)
        : factor === "email" && user
          ? maskEmail(user.email)
          : factor === "backup" && user
            ? `${user.twoFactorBackupCodes.length} left`
            : "",
  }));
  // The sign-in already sent the code when the preferred way is a text or an email.
  const autoSent = options[0]?.factor === "sms" || options[0]?.factor === "email";
  return (
    <AuthCard title="Two-step sign-in" description="One more step to keep your account safe.">
      {options.length > 0 ? (
        <TwoFactorForm options={options} autoSent={autoSent} />
      ) : (
        <Alert variant="warning">
          Your sign-in timed out. <Link href="/auth/sign-in">Sign in again</Link>
        </Alert>
      )}
    </AuthCard>
  );
}
