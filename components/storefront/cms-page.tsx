import { notFound } from "next/navigation";
import { getCmsPage } from "@/lib/cms/public";
import { formatDate } from "@/lib/datetime";

/** An about or contact page written in the admin console. Sanitised when saved (lib/sanitize.ts). */
export async function CmsPageView({ slug }: { slug: string }) {
  const page = await getCmsPage(slug);
  if (!page) notFound();
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl font-bold">{page.title}</h1>
      {page.summary && <p className="mt-3 text-lg text-muted-foreground">{page.summary}</p>}
      <div className="prose-tm mt-8 text-sm" dangerouslySetInnerHTML={{ __html: page.bodyHtml }} />
      <p className="mt-12 text-xs text-muted-foreground">Last updated {formatDate(page.updatedAt)}</p>
    </main>
  );
}

export async function cmsMetadata(slug: string) {
  const page = await getCmsPage(slug);
  return page ? { title: page.title, description: page.summary ?? undefined } : {};
}
