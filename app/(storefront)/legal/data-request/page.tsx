import type { Metadata } from "next";
import Link from "next/link";
import { PublicRequestForm } from "@/components/privacy/public-request-form";
import { withRls } from "@/lib/db";
import { getRetention } from "@/lib/compliance/retention";

export const metadata: Metadata = {
  title: "Data request",
  description: "Ask TownMart for a copy of your personal data, or to correct or delete it, under the Nigeria Data Protection Act 2023.",
};

export default async function DataRequestPage() {
  const retention = await withRls({ userId: null }, (tx) => getRetention(tx));
  return (
    <main id="main" className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold">Data request</h1>
      <p className="mt-3 text-sm leading-relaxed">
        Under the Nigeria Data Protection Act 2023 you can ask us for a copy of your personal data, to correct or delete it, to restrict or object to how we use it, or to
        withdraw a consent. Use this form if you don&apos;t have a TownMart account or can&apos;t sign in. If you can,{" "}
        <Link href="/account/privacy" className="font-medium text-primary underline">
          your Privacy Centre
        </Link>{" "}
        is quicker.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        We email you a link to confirm the request is yours, then reply within {retention.dsr_response} days. We may ask for more to confirm who you are before sharing
        anything. If you&apos;re not happy with our answer you can complain to the Nigeria Data Protection Commission.
      </p>
      <div className="mt-8 rounded-2xl border bg-card p-6">
        <PublicRequestForm />
      </div>
    </main>
  );
}
