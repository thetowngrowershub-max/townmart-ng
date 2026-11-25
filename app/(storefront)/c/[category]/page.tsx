import type { Metadata } from "next";
import { CategoryListing, loadCategory } from "@/components/storefront/category-listing";
import type { RawSearchParams } from "@/lib/search";

type Props = { params: Promise<{ category: string }>; searchParams: Promise<RawSearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const cat = await loadCategory((await params).category);
  if (!cat) return {};
  return { title: cat.top.name, description: `Shop ${cat.top.name.toLowerCase()} from verified Nigerian sellers on TownMart.`, alternates: { canonical: `/c/${cat.top.slug}` } };
}

export default async function CategoryPage({ params, searchParams }: Props) {
  return <CategoryListing slug={(await params).category} searchParams={await searchParams} />;
}
