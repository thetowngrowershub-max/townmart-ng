import type { MetadataRoute } from "next";

// Category, product, service and store URLs are added as the catalogue ships.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return [{ url: `${base}/`, changeFrequency: "daily", priority: 1 }];
}
