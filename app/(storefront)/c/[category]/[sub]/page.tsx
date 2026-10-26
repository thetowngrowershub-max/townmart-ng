import type { Metadata } from "next";
import { CategoryListing, loadCategory } from "@/components/storefront/category-listing";
import type { RawSearchParams } from "@/lib/search";

type Props = { params: Promise<{ category: string; sub: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { category, sub } = await params;
  const cat = await loadCategory(category, sub);
  if (!cat?.sub) return {};
  return {
    title: `${cat.sub.name} · ${cat.top.name}`,
    description: `Shop ${cat.sub.name.toLowerCase()} from verified Nigerian sellers on TownMart.`,
    alternates: { canonical: `/c/${cat.top.slug}/${cat.sub.slug}` },
  };
}

export default async function SubcategoryPage({ params, searchParams }: Props) {
  const { category, sub } = await params;
  return <CategoryListing slug={category} subSlug={sub} searchParams={await searchParams} />;
}
