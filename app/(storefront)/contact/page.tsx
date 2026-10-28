import type { Metadata } from "next";
import { cmsMetadata, CmsPageView } from "@/components/storefront/cms-page";

export const dynamic = "force-dynamic";

export const generateMetadata = (): Promise<Metadata> => cmsMetadata("contact");

export default function Page() {
  return <CmsPageView slug="contact" />;
}
