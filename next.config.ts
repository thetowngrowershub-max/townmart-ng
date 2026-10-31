import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=(self)" },
];

/** Public image host for next/image when storage is S3/MinIO. Read at build time. */
function remoteImagePatterns(): NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]> {
  const base = process.env.S3_PUBLIC_BASE_URL;
  if (!base) return [];
  const u = new URL(base);
  return [{ protocol: u.protocol.replace(":", "") as "http" | "https", hostname: u.hostname, port: u.port, pathname: `${u.pathname.replace(/\/$/, "")}/**` }];
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Enables forbidden() / app/forbidden.tsx for 403 responses.
  experimental: { authInterrupts: true },
  serverExternalPackages: ["@node-rs/argon2", "pino", "bullmq", "ioredis", "sharp", "isomorphic-dompurify"],
  images: {
    formats: ["image/avif", "image/webp"],
    // Local storage serves images from /api/storage/public (same origin); S3/MinIO needs its host listed.
    remotePatterns: remoteImagePatterns(),
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Pages get a nonce-based policy from middleware.ts; API responses never run scripts.
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'" }] },
    ];
  },
};

export default nextConfig;
