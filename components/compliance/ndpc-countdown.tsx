"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

const fmt = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
};

/** The 72-hour NDPC clock, ticking each minute. */
export function NdpcCountdown({ deadline, notifiedAt }: { deadline: string; notifiedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const due = new Date(deadline).getTime();
  if (notifiedAt) {
    const onTime = new Date(notifiedAt).getTime() <= due;
    return <Badge variant={onTime ? "success" : "warning"}>NDPC told{onTime ? " in time" : " late"}</Badge>;
  }
  const left = due - now;
  return left >= 0 ? (
    <Badge variant={left < 24 * 3600_000 ? "danger" : "warning"} role="timer" aria-live="off">
      NDPC due in {fmt(left)}
    </Badge>
  ) : (
    <Badge variant="danger">NDPC overdue by {fmt(-left)}</Badge>
  );
}
