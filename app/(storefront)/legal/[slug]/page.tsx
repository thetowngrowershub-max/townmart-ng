import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { withRls } from "@/lib/db";
import { formatDate } from "@/lib/datetime";
import { fillPlaceholders, isLegalSlug, placeholderValues } from "@/lib/legal/documents";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ v?: string }> };

export const dynamic = "force-dynamic";

async function load(slug: string, requested?: string) {
  if (!isLegalSlug(slug)) return null;
  return withRls({ userId: null }, async (tx) => {
    const now = new Date();
    const versions = await tx.legalDocument.findMany({
      where: { slug },
      orderBy: [{ effectiveAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, version: true, effectiveAt: true, changeNote: true },
    });
    const current = versions.find((v) => v.effectiveAt <= now);
    const upcoming = versions.filter((v) => v.effectiveAt > now).at(-1) ?? null;
    const shownId = (requested && versions.find((v) => v.version === requested)?.id) || current?.id;
    if (!shownId) return null;
    const doc = await tx.legalDocument.findUniqueOrThrow({ where: { id: shownId } });
    return { doc, current, upcoming, versions, values: await placeholderValues(tx) };
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const data = await load((await params).slug);
  return data ? { title: data.doc.title, description: data.doc.summary } : {};
}

export default async function LegalPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { v } = await searchParams;
  const data = await load(slug, v);
  if (!data) notFound();
  const { doc, current, upcoming, versions } = data;
  const body = fillPlaceholders(doc.bodyHtml, data.values);
  const isCurrent = doc.id === current?.id;
  const isUpcoming = doc.effectiveAt > new Date();

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">{doc.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Last updated {formatDate(doc.effectiveAt)} · Version {doc.version}
      </p>
      {doc.isTemplate && (
        <Alert variant="warning" className="my-6">
          Template — review with a Nigerian lawyer/DPO before launch.
        </Alert>
      )}
      {!isCurrent && current && (
        <Alert variant="info" className="my-6">
          {isUpcoming ? `This version takes effect on ${formatDate(doc.effectiveAt)}.` : "This is an earlier version."}{" "}
          <Link href={`/legal/${slug}`}>Read the version in force now</Link>
        </Alert>
      )}
      {isCurrent && upcoming && (
        <Alert variant="info" className="my-6">
          A new version takes effect on {formatDate(upcoming.effectiveAt)}. <Link href={`/legal/${slug}?v=${encodeURIComponent(upcoming.version)}`}>Read it now</Link>
        </Alert>
      )}
      <p className="my-6">{doc.summary}</p>
      <div className="prose-tm text-sm" dangerouslySetInnerHTML={{ __html: body.html }} />
      {versions.length > 1 && (
        <section className="mt-12 border-t pt-6">
          <h2 className="mb-3 text-base font-semibold">Version history</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {versions.map((ver) => (
              <li key={ver.id} className="flex flex-wrap gap-x-2">
                <Link href={`/legal/${slug}?v=${encodeURIComponent(ver.version)}`} className="font-medium text-primary underline-offset-2 hover:underline" aria-current={ver.id === doc.id ? "page" : undefined}>
                  {ver.version}
                </Link>
                <span className="text-muted-foreground">from {formatDate(ver.effectiveAt)}</span>
                {ver.changeNote && <span className="text-muted-foreground">· {ver.changeNote}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
