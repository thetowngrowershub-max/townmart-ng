"use client";

/** Forgets the pages saved for offline use (sign-out, shared phones). Matches PAGE_CACHE in public/sw.js. */
export function clearSavedPages(): void {
  navigator.serviceWorker?.controller?.postMessage({ type: "clear-pages" });
  if ("caches" in window) void caches.delete("tm-pages-v1").catch(() => false);
  try {
    localStorage.removeItem("tm_cart_queue");
  } catch {
    /* Nothing saved. */
  }
}
