import type { Instrumentation } from "next";

export function register() {}

/**
 * On a test-mode site, or a live one with HEALTH_KEY, keeps the last few page
 * errors (scrubbed of secrets) in Redis so /api/health can show them when the
 * host's logs are hard to reach.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  // The import sits inside this check so the edge build leaves Redis out.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.TOWNMART_TEST_MODE !== "true" && !process.env.HEALTH_KEY) return;
    try {
      const { recordPageError } = await import("@/lib/test-mode/page-errors");
      await recordPageError(error, request.path);
    } catch {
      // Never let error reporting cause another error.
    }
  }
};
