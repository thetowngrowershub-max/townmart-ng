import type { Metadata } from "next";
import { UnsubscribeButton } from "@/components/consent/unsubscribe-button";
import { Alert } from "@/components/ui/alert";
import { verifyUnsubscribe } from "@/lib/marketing";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ e?: string; t?: string }> }) {
  const { e, t } = await searchParams;
  const email = verifyUnsubscribe(e, t);
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold">Unsubscribe from offers</h1>
      {email ? (
        <div className="mt-6 flex flex-col gap-4">
          <p className="text-sm">
            Stop marketing emails and texts to <strong>{email}</strong>.
          </p>
          <UnsubscribeButton e={e!} t={t!} />
        </div>
      ) : (
        <Alert variant="danger" className="mt-6">
          This unsubscribe link isn&apos;t valid. Use the link from your latest email, or switch offers off in your account&apos;s notification settings.
        </Alert>
      )}
    </main>
  );
}
