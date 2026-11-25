"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * False when the phone says it has no connection. True does not promise the
 * connection works (a weak signal still counts as online), so callers that
 * send something must still handle a failed request.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

/** A request that never reached TownMart (no signal, dropped connection, timeout), as opposed to TownMart saying no. */
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!(err instanceof Error)) return false;
  return err.name === "TypeError" || /fetch|network|load failed|connection/i.test(err.message);
}
