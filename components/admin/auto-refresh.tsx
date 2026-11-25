"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every `seconds` while the tab is visible. A tiny request on slow networks, nothing when hidden. */
export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
