"use client";

import { useEffect } from "react";

const KEY = "townmart:maintenance-tick";

/**
 * Where there's no worker (lib/platform.ts jobsInline), page views stand in
 * for its clock: at most once a minute per browser, this asks the server to
 * run any scheduled jobs that are due. The server keeps its own limit too.
 */
export function MaintenanceTick() {
  useEffect(() => {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem(KEY, String(Date.now()));
    void fetch("/api/jobs/tick", { method: "POST", keepalive: true }).catch(() => undefined);
  }, []);
  return null;
}
