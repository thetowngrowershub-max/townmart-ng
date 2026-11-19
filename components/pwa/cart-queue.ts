"use client";

import { addToCartAction } from "@/lib/cart/actions";
import { isNetworkError } from "./use-online";

/**
 * Items a shopper tapped "Add to cart" on while offline. They wait on the
 * phone and are added when the connection is back. The server checks price,
 * stock and opening hours then, exactly as for a normal add; each entry has
 * its own id, so a replay that is sent twice is still added once.
 */
export type QueuedAdd = { opId: string; variantId: string; qty: string; label: string; at: number };

const KEY = "tm_cart_queue";
const MAX_AGE_MS = 3 * 24 * 3600 * 1000;
export const CART_QUEUE_EVENT = "tm-cart-queue";

function read(): QueuedAdd[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedAdd[];
    return Array.isArray(list) ? list.filter((q) => Date.now() - q.at < MAX_AGE_MS) : [];
  } catch {
    return [];
  }
}

function write(list: QueuedAdd[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    /* Private mode or a full phone: nothing to keep. */
  }
}

export function queuedAdds(): QueuedAdd[] {
  return typeof window === "undefined" ? [] : read();
}

export function queueAdd(item: Omit<QueuedAdd, "opId" | "at">): void {
  write([...read(), { ...item, opId: crypto.randomUUID(), at: Date.now() }]);
  window.dispatchEvent(new CustomEvent(CART_QUEUE_EVENT, { detail: { added: 0, failed: [] } }));
}

let flushing = false;

/** Sends the saved adds. Ones that fail for a reason (sold out, closed) are dropped and reported. */
export async function flushCartQueue(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  const list = read();
  if (!list.length) return;
  flushing = true;
  const run = async () => {
    let added = 0;
    const failed: string[] = [];
    for (const q of read()) {
      try {
        const res = await addToCartAction({ variantId: q.variantId, qty: q.qty, opId: q.opId });
        if (res.ok) added++;
        else if (/wait a moment/i.test(res.error)) continue; // Busy or rate limited: try again next time.
        else failed.push(`${q.label}: ${res.error}`);
      } catch (err) {
        if (isNetworkError(err)) break; // Still no connection; keep the rest for later.
        failed.push(`${q.label}: couldn't be added.`);
      }
      write(read().filter((x) => x.opId !== q.opId));
    }
    window.dispatchEvent(new CustomEvent(CART_QUEUE_EVENT, { detail: { added, failed } }));
  };
  try {
    // One tab at a time, so two open tabs don't both send the same list.
    if (navigator.locks) await navigator.locks.request("tm-cart-queue", run);
    else await run();
  } finally {
    flushing = false;
  }
}
