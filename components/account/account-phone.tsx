"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PhoneCodeFlow } from "@/components/auth/phone-code-flow";
import { Button } from "@/components/ui/button";
import { removeAccountPhoneAction, sendPhoneVerificationCodeAction, verifyAccountPhoneAction } from "@/lib/auth/phone-actions";

export function AccountPhone({ masked }: { masked: string | null }) {
  const router = useRouter();
  const [changing, setChanging] = useState(!masked);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (masked && !changing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {error && <p className="basis-full text-sm font-medium text-danger">{error}</p>}
        <p className="text-sm">
          <strong>{masked}</strong> is verified. You can use it to sign in with a code.
        </p>
        <Button variant="outline" size="sm" onClick={() => setChanging(true)}>
          Change
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await removeAccountPhoneAction();
              setError(res.ok ? null : res.error);
              router.refresh();
            })
          }
        >
          Remove
        </Button>
      </div>
    );
  }
  return (
    <div className="max-w-sm">
      <PhoneCodeFlow
        send={sendPhoneVerificationCodeAction}
        verify={verifyAccountPhoneAction}
        submitLabel="Verify number"
        onVerified={() => {
          setChanging(false);
          router.refresh();
        }}
      />
    </div>
  );
}
