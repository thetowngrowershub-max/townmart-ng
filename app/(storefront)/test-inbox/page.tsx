import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDateTime } from "@/lib/datetime";
import { readOutbox } from "@/lib/notifications/outbox";
import { isTestMode } from "@/lib/platform";

export const metadata: Metadata = { title: "Test inbox", robots: { index: false } };
export const dynamic = "force-dynamic";

const URL_RE = /(https?:\/\/[^\s<>"]+)/g;

/** Turns the links in a plain-text email into links you can click. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(URL_RE).map((part, i) =>
        i % 2 === 1 ? (
          <a key={i} href={part} className="break-all text-primary underline underline-offset-2">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

const masked = (phone: string) => (phone.length > 6 ? `${phone.slice(0, 4)}…${phone.slice(-4)}` : phone);

/**
 * Test-mode sites only: the emails and SMS the site would have sent, newest
 * first, so testers can confirm accounts and read one-time codes.
 */
export default async function TestInboxPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  if (!isTestMode()) notFound();
  const { to } = await searchParams;
  const messages = await readOutbox(to);

  return (
    <main id="main" className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div>
        <h1 className="font-display text-2xl font-semibold">Test inbox</h1>
        <p className="text-muted-foreground">
          On this test site, emails and SMS aren&apos;t sent. They appear here instead, for a week. Anyone using the test site can see this page, so use made-up details.
        </p>
      </div>
      <form className="flex items-end gap-2" role="search">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="to">Email address or phone number</Label>
          <Input id="to" name="to" defaultValue={to ?? ""} placeholder="e.g. ada@example.com" />
        </div>
        <Button type="submit" variant="outline">
          Show
        </Button>
      </form>
      {messages.length === 0 ? (
        <p className="text-muted-foreground">Nothing yet. Sign up, request a code or place an order, then refresh this page.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {messages.map((m) => (
            <li key={m.id} className="rounded-xl border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {m.kind === "email" ? "Email" : "SMS"} to {m.kind === "sms" ? masked(m.to) : m.to} · {formatDateTime(new Date(m.at))}
              </p>
              {m.kind === "email" && <h2 className="mt-1 font-semibold">{m.subject}</h2>}
              <p className="mt-2 text-sm whitespace-pre-line">
                <Linkified text={m.text} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
