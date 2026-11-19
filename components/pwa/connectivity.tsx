"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useOnline } from "./use-online";
import { CART_QUEUE_EVENT, flushCartQueue, queuedAdds } from "./cart-queue";

const ago = (ms: number) => {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 2) return "a moment ago";
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
};

/**
 * Registers the service worker and shows a thin bar when the phone is offline
 * or the page is a saved copy. Saved copies can show old prices and stock, so
 * the bar says that the cart and checkout check them again.
 */
export function Connectivity() {
  const online = useOnline();
  const router = useRouter();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(0);
  const [notice, setNotice] = useState<{ added: number; failed: string[] } | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "page-status") setSavedAt(e.data.savedAt || null);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    navigator.serviceWorker.controller?.postMessage({ type: "page-status" });
    // After the page has loaded, so registering never slows the first visit.
    const register = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Adds the cart items saved while offline, once the connection is back.
  useEffect(() => {
    const onQueue = (e: Event) => {
      const detail = (e as CustomEvent<{ added: number; failed: string[] }>).detail;
      setWaiting(queuedAdds().length);
      if (detail.added || detail.failed.length) {
        setNotice(detail);
        router.refresh();
      }
    };
    window.addEventListener(CART_QUEUE_EVENT, onQueue);
    setWaiting(queuedAdds().length);
    if (online) void flushCartQueue();
    return () => window.removeEventListener(CART_QUEUE_EVENT, onQueue);
  }, [online, router]);

  if (notice) {
    return (
      <div role="status" className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b-2 border-success bg-card px-4 py-2.5 text-center text-xs font-medium shadow-[0_8px_24px_rgba(0,0,0,0.08)] sm:text-sm">
        <span>
          {notice.added > 0 && `You're back online. ${notice.added} item${notice.added === 1 ? "" : "s"} you saved ${notice.added === 1 ? "is" : "are"} now in your cart. `}
          {notice.failed.length > 0 && `Not added: ${notice.failed.join("; ")}`}
        </span>
        <a href="/cart" className="font-semibold text-primary underline">
          View cart
        </a>
        <button type="button" onClick={() => setNotice(null)} className="font-semibold underline">
          Dismiss
        </button>
      </div>
    );
  }
  if (online && !savedAt) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-[60] flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b-2 border-warning bg-card px-4 py-2.5 text-center text-xs font-medium text-foreground shadow-[0_8px_24px_rgba(0,0,0,0.08)] sm:text-sm">
      <WifiOff className="size-4 shrink-0 text-warning" aria-hidden />
      <span>
        {online
          ? `Your connection is slow, so this is the copy saved ${ago(savedAt!)}.`
          : savedAt
            ? `You're offline. This is the copy saved ${ago(savedAt)}.`
            : "You're offline. You can keep browsing pages you've opened before."}{" "}
        {!online && waiting > 0 && `${waiting} item${waiting === 1 ? "" : "s"} will go into your cart when you're back online. `}
        Prices and stock are checked again before you pay.
      </span>
      {online && (
        <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1 font-semibold text-primary underline">
          <RefreshCw className="size-3.5" aria-hidden /> Refresh
        </button>
      )}
    </div>
  );
}
