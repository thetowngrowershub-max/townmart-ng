import type { MetadataRoute } from "next";
import { isTestMode, platformAppUrl } from "@/lib/platform";

// Read per request, so turning test mode on or off takes effect without a rebuild.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = platformAppUrl() ?? "http://localhost:3000";
  // A test site's demo shops must never show up in search results.
  if (isTestMode()) return { rules: [{ userAgent: "*", disallow: "/" }] };
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/dashboard", "/admin", "/design-system", "/auth", "/api", "/checkout", "/cart"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
