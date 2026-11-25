import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { formatDate } from "@/lib/datetime";
import { confirmPublicRequest } from "@/lib/privacy/confirm";

export const metadata: Metadata = { title: "Confirm your data request", robots: { index: false } };

export default async function ConfirmDataRequestPage({ searchParams }: { searchParams: Promise<{ id?: string; token?: string }> }) {
  const { id, token } = await searchParams;
  const confirmed = id && token ? await confirmPublicRequest(id, token) : null;
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-bold">Data request</h1>
      {confirmed ? (
        <Alert variant="success" className="mt-6">
          Thanks, your request {confirmed.reference} is confirmed. We&apos;ll reply by email{confirmed.dueAt ? ` by ${formatDate(confirmed.dueAt)}` : ""}.
        </Alert>
      ) : (
        <Alert variant="danger" className="mt-6">
          This link has expired or was already used. <Link href="/legal/data-request">Send the request again</Link>.
        </Alert>
      )}
    </main>
  );
}
