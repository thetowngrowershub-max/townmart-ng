import { describe, expect, it } from "vitest";
import { buildCsp, cleanSources, originOf } from "@/lib/security/csp";

/** Phase 8: the Content-Security-Policy. */

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

describe("content security policy", () => {
  const base = { nonce: "abc123==", dev: false, https: true, storageUrls: ["https://s3.example.ng", "https://media.example.ng/townmart-public"], scriptUrls: [] };

  it("only runs scripts with the request's nonce", () => {
    const csp = buildCsp(base);
    const script = directive(csp, "script-src");
    expect(script).toContain("'nonce-abc123=='");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("allows uploads and images only to the configured storage, and checkout redirects only to the payment pages", () => {
    const csp = buildCsp(base);
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https://s3.example.ng https://media.example.ng");
    expect(directive(csp, "form-action")).toBe("form-action 'self' https://checkout.paystack.com https://checkout.flutterwave.com");
  });

  it("adds consent-gated script hosts and the development extras only when needed", () => {
    const csp = buildCsp({ ...base, dev: true, https: false, scriptUrls: ["https://www.googletagmanager.com/gtag/js?id=G-1", undefined] });
    expect(directive(csp, "script-src")).toContain("https://www.googletagmanager.com");
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("ignores configured sources that could break out of the policy", () => {
    expect(cleanSources("https://a.example.com *.b.example.com 'unsafe-inline' x;script-src https://c.example.com:8443")).toEqual(["https://a.example.com", "*.b.example.com", "https://c.example.com:8443"]);
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("http://minio:9000/bucket")).toBe("http://minio:9000");
  });
});
