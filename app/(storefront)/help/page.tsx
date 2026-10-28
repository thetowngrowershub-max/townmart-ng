import type { Metadata } from "next";
import Link from "next/link";
import { getFaq } from "@/lib/cms/public";
import { slugify } from "@/lib/slug";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Help centre", description: "Answers about buying, booking, delivery, refunds and selling on TownMart." };

export default async function HelpPage() {
  const sections = await getFaq();
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">Help centre</h1>
      <p className="mt-3 text-muted-foreground">
        Answers to common questions. Can&apos;t find yours?{" "}
        <Link href="/contact" className="font-medium text-primary underline">
          Contact us
        </Link>
        .
      </p>
      {sections.length > 1 && (
        <nav aria-label="Help topics" className="mt-6 flex flex-wrap gap-2">
          {sections.map((s) => (
            <a key={s.name} href={`#${slugify(s.name)}`} className="rounded-full border px-3 py-1.5 text-sm hover:bg-muted">
              {s.name}
            </a>
          ))}
        </nav>
      )}
      {sections.length === 0 && <p className="mt-8 text-sm text-muted-foreground">No answers have been published yet.</p>}
      {sections.map((s) => (
        <section key={s.name} id={slugify(s.name)} aria-labelledby={`h-${slugify(s.name)}`} className="mt-10 scroll-mt-24">
          <h2 id={`h-${slugify(s.name)}`} className="mb-3 text-xl font-semibold">
            {s.name}
          </h2>
          <div className="flex flex-col gap-2">
            {s.entries.map((e) => (
              <details key={e.id} className="group rounded-2xl border bg-card">
                <summary className="cursor-pointer list-none px-5 py-4 font-medium marker:hidden">{e.question}</summary>
                {/* Sanitised when saved (lib/sanitize.ts). */}
                <div className="prose-tm border-t px-5 py-4 text-sm" dangerouslySetInnerHTML={{ __html: e.answerHtml }} />
              </details>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
