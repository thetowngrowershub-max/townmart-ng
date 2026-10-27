"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { saveConsentAction } from "@/lib/consent/actions";
import { CONSENT_CATEGORIES, type ConsentChoices } from "@/lib/consent/cookie";

export const OPEN_COOKIE_SETTINGS = "tm:cookie-settings";

const CATEGORY_COPY: Record<keyof ConsentChoices, { label: string; hint: string }> = {
  functional: { label: "Functional", hint: "Remember preferences such as recently viewed items." },
  analytics: { label: "Analytics", hint: "Help us see, in aggregate, how TownMart is used." },
  marketing: { label: "Marketing", hint: "Measure and personalise our adverts on other sites." },
};

/**
 * The cookie banner. Accept all, Reject non-essential and Customise carry
 * equal weight. It opens on a first visit (or when the Cookie Policy has
 * changed) and again from "Cookie settings" in the footer.
 */
export function ConsentBanner({ initialOpen, current }: { initialOpen: boolean; current: ConsentChoices }) {
  const router = useRouter();
  const [open, setOpen] = useState(initialOpen);
  const [customising, setCustomising] = useState(false);
  const [choices, setChoices] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const show = () => {
      setChoices(current);
      setCustomising(true);
      setOpen(true);
    };
    window.addEventListener(OPEN_COOKIE_SETTINGS, show);
    return () => window.removeEventListener(OPEN_COOKIE_SETTINGS, show);
  }, [current]);

  if (!open) return null;

  const save = (c: ConsentChoices) =>
    start(async () => {
      const res = await saveConsentAction({ ...c, source: initialOpen ? "banner" : "settings" });
      if (!res.ok) return setError(res.error);
      setError(null);
      setOpen(false);
      setCustomising(false);
      router.refresh();
    });

  return (
    <section
      role="region"
      aria-label="Cookie choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t bg-card shadow-[0_-8px_24px_rgba(0,0,0,0.08)]"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-5">
        <div>
          <h2 className="text-base font-semibold">Your cookie choices</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We use necessary cookies to keep you signed in and your cart working. With your permission we&apos;d also use functional, analytics and marketing cookies. Nothing optional is set until you choose.{" "}
            <Link href="/legal/cookies" className="font-medium text-primary underline">
              Cookie Policy
            </Link>
          </p>
        </div>
        {error && <Alert variant="danger">{error}</Alert>}
        {customising && (
          <fieldset className="grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Cookie categories</legend>
            <Checkbox id="consent-necessary" label="Necessary" hint="Always on: sign-in, security and your cart." checked disabled readOnly />
            {CONSENT_CATEGORIES.map((k) => (
              <Checkbox
                key={k}
                id={`consent-${k}`}
                label={CATEGORY_COPY[k].label}
                hint={CATEGORY_COPY[k].hint}
                checked={choices[k]}
                onChange={(e) => setChoices((c) => ({ ...c, [k]: e.target.checked }))}
              />
            ))}
          </fieldset>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Button disabled={pending} onClick={() => save({ functional: true, analytics: true, marketing: true })}>
            Accept all
          </Button>
          <Button disabled={pending} onClick={() => save({ functional: false, analytics: false, marketing: false })}>
            Reject non-essential
          </Button>
          {customising ? (
            <Button disabled={pending} onClick={() => save(choices)}>
              Save my choices
            </Button>
          ) : (
            <Button disabled={pending} onClick={() => setCustomising(true)}>
              Customise
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
