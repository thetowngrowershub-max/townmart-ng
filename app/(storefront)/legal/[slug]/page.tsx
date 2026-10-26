import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { LEGAL_DRAFTS } from "@/lib/legal-drafts";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const doc = LEGAL_DRAFTS[(await params).slug];
  return doc ? { title: doc.title, description: doc.summary } : {};
}

export default async function LegalPage({ params }: Props) {
  const doc = LEGAL_DRAFTS[(await params).slug];
  if (!doc) notFound();
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">{doc.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Version {doc.version}</p>
      <Alert variant="warning" className="my-6">
        Draft pending legal review. The final, versioned text will replace this page; you&apos;ll be asked to accept it again if it changes materially.
      </Alert>
      <p className="mb-6">{doc.summary}</p>
      {doc.sections.map((s) => (
        <section key={s.heading} className="mb-6">
          <h2 className="mb-2 text-lg font-semibold">{s.heading}</h2>
          {s.body.map((p) => (
            <p key={p} className="mb-2 text-sm leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      ))}
    </main>
  );
}
