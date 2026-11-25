"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  confirmAuthenticatorAction,
  confirmChannelAction,
  disableTwoFactorAction,
  regenerateBackupCodesAction,
  removeAuthenticatorAction,
  sendSecurityCodeAction,
  setPreferredMethodAction,
  startAuthenticatorSetupAction,
  type AuthenticatorSetup,
} from "@/lib/auth/two-factor-actions";
import type { ActionResult } from "@/lib/validation/form-result";

type Method = "authenticator" | "sms" | "email";
type Factor = Method | "backup";
export type StepUpOption = { factor: Factor; label: string };

export type TwoFactorSettingProps = {
  enabled: boolean;
  method: Method | null;
  ready: Record<Method, boolean>;
  phoneMasked: string | null;
  emailMasked: string;
  emailVerified: boolean;
  backupRemaining: number;
  stepUpOptions: StepUpOption[];
};

const codeInput = (factor: Factor) => ({
  inputMode: factor === "backup" ? ("text" as const) : ("numeric" as const),
  autoComplete: "one-time-code",
  autoCapitalize: "none",
  maxLength: factor === "backup" ? 12 : 6,
});

function ResultAlert({ result }: { result: ActionResult<unknown> | null }) {
  if (!result) return null;
  return <Alert variant={result.ok ? "success" : "danger"}>{result.ok ? result.message : result.error}</Alert>;
}

/** Shown once after turning it on or making new codes. */
function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `TownMart backup codes (each works once)\n\n${codes.join("\n")}\n`;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-muted/40 p-4">
      <p className="text-sm font-semibold">Save your backup codes</p>
      <p className="text-sm text-muted-foreground">
        If you lose your phone, each of these lets you sign in once. Keep them somewhere safe, like a password manager or on paper. We won&apos;t show them again.
      </p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(text)}>
          Copy
        </Button>
        <Button type="button" variant="outline" size="sm" asChild>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="townmart-backup-codes.txt">
            Download
          </a>
        </Button>
        <Button type="button" size="sm" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

/** Asks for a current second-step code before a change that weakens the account. */
function StepUp({
  options,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  options: StepUpOption[];
  confirmLabel: string;
  danger?: boolean;
  onConfirm: (factor: Factor, code: string) => Promise<ActionResult<unknown>>;
  onCancel: () => void;
}) {
  const [factor, setFactor] = useState<Factor>(options[0]?.factor ?? "authenticator");
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const sendable = factor === "sms" || factor === "email";
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => setResult(await onConfirm(factor, code)));
      }}
    >
      <p className="text-sm">To confirm it&apos;s you, enter a code.</p>
      <ResultAlert result={result} />
      {options.length > 1 && (
        <FormField id="step-up-factor" label="Get a code from">
          <Select
            value={factor}
            onChange={(e) => {
              setFactor(e.target.value as Factor);
              setCode("");
              setResult(null);
            }}
          >
            {options.map((o) => (
              <option key={o.factor} value={o.factor}>
                {o.label}
              </option>
            ))}
          </Select>
        </FormField>
      )}
      {sendable && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          disabled={pending}
          onClick={() => start(async () => setResult(await sendSecurityCodeAction({ factor: factor as "sms" | "email" })))}
        >
          {factor === "sms" ? "Text me a code" : "Email me a code"}
        </Button>
      )}
      <FormField id="step-up-code" label={factor === "backup" ? "Backup code" : "Code"}>
        <Input {...codeInput(factor)} value={code} onChange={(e) => setCode(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={danger ? "danger" : "default"} disabled={pending}>
          {confirmLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AuthenticatorSetupForm({ onDone, onCancel }: { onDone: (res: ActionResult<{ backupCodes: string[] | null }>) => void; onCancel: () => void }) {
  const [setup, setSetup] = useState<AuthenticatorSetup | null>(null);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();

  if (!setup) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border p-4">
        <p className="text-sm">
          Install a free authenticator app such as Google Authenticator or Microsoft Authenticator on your phone, then continue to scan a QR code.
        </p>
        <ResultAlert result={result} />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await startAuthenticatorSetupAction();
                if (res.ok && res.data) setSetup(res.data);
                else setResult(res);
              })
            }
          >
            Continue
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <form
      noValidate
      className="flex flex-col gap-4 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await confirmAuthenticatorAction({ code });
          if (res.ok) onDone(res);
          else setResult(res);
        });
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm">
        <li>In the app, add an account and scan this QR code.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* The SVG is generated on our server from the otpauth link, not user input. */}
      <div className="size-44 rounded-lg bg-white p-2" aria-label="QR code for your authenticator app" role="img" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      <p className="text-sm text-muted-foreground">
        Can&apos;t scan? On your phone,{" "}
        <a className="font-medium text-primary underline" href={setup.url}>
          open the link in your app
        </a>{" "}
        or type this key: <code className="break-all font-mono text-foreground">{setup.secret}</code>
      </p>
      <ResultAlert result={result} />
      <FormField id="totp-code" label="Code from the app">
        <Input {...codeInput("authenticator")} value={code} onChange={(e) => setCode(e.target.value)} />
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          Link app
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Text-message or email codes: send one to that channel and enter it to turn it on. */
function ChannelSetupForm({
  method,
  target,
  onDone,
  onCancel,
}: {
  method: "sms" | "email";
  target: string;
  onDone: (res: ActionResult<{ backupCodes: string[] | null }>) => void;
  onCancel: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const send = () =>
    start(async () => {
      const res = await sendSecurityCodeAction({ factor: method });
      setResult(res);
      if (res.ok) setSent(true);
    });
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-xl border p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await confirmChannelAction({ method, code });
          if (res.ok) onDone(res);
          else setResult(res);
        });
      }}
    >
      <p className="text-sm">
        We&apos;ll {method === "sms" ? "text" : "email"} a code to <strong>{target}</strong>. Enter it to confirm.
      </p>
      <ResultAlert result={result} />
      {sent ? (
        <>
          <FormField id={`${method}-code`} label="6-digit code">
            <Input {...codeInput(method)} value={code} onChange={(e) => setCode(e.target.value)} />
          </FormField>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              Confirm
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={send}>
              Send a new code
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={pending} onClick={send}>
            Send code
          </Button>
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
    </form>
  );
}

type Panel = { kind: "setup"; method: Method } | { kind: "remove-app" } | { kind: "regenerate" } | { kind: "disable" } | null;

/**
 * Two-step sign-in settings for every kind of account. The authenticator app
 * is recommended; text-message and email codes work too, and backup codes
 * cover a lost phone.
 */
export function TwoFactorSetting(props: TwoFactorSettingProps) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();

  const finished = (res: ActionResult<{ backupCodes: string[] | null }>) => {
    setResult(res);
    setPanel(null);
    if (res.ok && res.data?.backupCodes) setCodes(res.data.backupCodes);
    router.refresh();
  };

  const methods: { method: Method; title: string; detail: string; unavailable: string | null }[] = [
    {
      method: "authenticator",
      title: "Authenticator app",
      detail: "Recommended. Free, works without signal or data, and safe from SIM swaps.",
      unavailable: null,
    },
    {
      method: "sms",
      title: "Text message",
      detail: props.phoneMasked ? `Codes texted to ${props.phoneMasked}.` : "Codes texted to your phone.",
      unavailable: props.phoneMasked ? null : "Verify a phone number above to use this.",
    },
    {
      method: "email",
      title: "Email",
      detail: `Codes emailed to ${props.emailMasked}.`,
      unavailable: props.emailVerified ? null : "Confirm your email address to use this.",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        Two-step sign-in is <strong>{props.enabled ? "on" : "off"}</strong>.{" "}
        {props.enabled
          ? "Every sign-in, whether with your password, a text-message code or Google, also asks for a code."
          : "Turn it on so a stolen password alone can't get into your account. Choose how you'd like to get codes."}
      </p>
      <ResultAlert result={result} />
      {codes && <BackupCodes codes={codes} onDone={() => setCodes(null)} />}

      <ul className="divide-y rounded-xl border">
        {methods.map((m) => {
          const isReady = props.ready[m.method];
          const isPreferred = props.enabled && props.method === m.method;
          const open = panel?.kind === "setup" && panel.method === m.method;
          return (
            <li key={m.method} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {m.title} {isPreferred && <Badge className="ml-1">Asked first</Badge>}
                    {m.method === "authenticator" && isReady && !isPreferred && <Badge className="ml-1">Linked</Badge>}
                  </p>
                  <p className="text-sm text-muted-foreground">{m.unavailable ?? m.detail}</p>
                </div>
                {!m.unavailable && !open && (
                  <div className="flex flex-wrap gap-2">
                    {props.enabled && isReady && !isPreferred && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => start(async () => setResult(await setPreferredMethodAction({ method: m.method })))}
                      >
                        Ask for this first
                      </Button>
                    )}
                    {m.method === "authenticator" && isReady ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setPanel({ kind: "remove-app" })}>
                        Unlink
                      </Button>
                    ) : (
                      (!props.enabled || m.method === "authenticator") && (
                        <Button type="button" size="sm" variant={m.method === "authenticator" ? "default" : "outline"} onClick={() => setPanel({ kind: "setup", method: m.method })}>
                          {props.enabled ? "Set up" : "Turn on"}
                        </Button>
                      )
                    )}
                  </div>
                )}
              </div>
              {open && m.method === "authenticator" && <AuthenticatorSetupForm onDone={finished} onCancel={() => setPanel(null)} />}
              {open && m.method !== "authenticator" && (
                <ChannelSetupForm
                  method={m.method}
                  target={m.method === "sms" ? (props.phoneMasked ?? "") : props.emailMasked}
                  onDone={finished}
                  onCancel={() => setPanel(null)}
                />
              )}
              {panel?.kind === "remove-app" && m.method === "authenticator" && (
                <StepUp
                  options={props.stepUpOptions}
                  confirmLabel="Unlink app"
                  danger
                  onCancel={() => setPanel(null)}
                  onConfirm={async (factor, code) => {
                    const res = await removeAuthenticatorAction({ factor, code });
                    if (res.ok) finished(res as ActionResult<{ backupCodes: string[] | null }>);
                    return res;
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>

      {props.enabled && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>Backup codes:</strong> {props.backupRemaining} unused left.
            </p>
            {panel?.kind !== "regenerate" && (
              <Button type="button" size="sm" variant="outline" onClick={() => setPanel({ kind: "regenerate" })}>
                Make new backup codes
              </Button>
            )}
          </div>
          {panel?.kind === "regenerate" && (
            <StepUp
              options={props.stepUpOptions.filter((o) => o.factor !== "backup")}
              confirmLabel="Make new codes"
              onCancel={() => setPanel(null)}
              onConfirm={async (factor, code) => {
                const res = await regenerateBackupCodesAction({ factor, code });
                if (res.ok) finished({ ok: true, message: res.message, data: { backupCodes: res.data?.backupCodes ?? null } });
                return res;
              }}
            />
          )}
          {panel?.kind === "disable" ? (
            <StepUp
              options={props.stepUpOptions}
              confirmLabel="Turn off two-step sign-in"
              danger
              onCancel={() => setPanel(null)}
              onConfirm={async (factor, code) => {
                const res = await disableTwoFactorAction({ factor, code });
                if (res.ok) finished(res as ActionResult<{ backupCodes: string[] | null }>);
                return res;
              }}
            />
          ) : (
            <Button type="button" variant="ghost" className="self-start text-danger" onClick={() => setPanel({ kind: "disable" })}>
              Turn off two-step sign-in
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
