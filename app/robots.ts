import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/account", "/dashboard", "/admin", "/design-system", "/auth", "/api", "/checkout", "/cart"] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
