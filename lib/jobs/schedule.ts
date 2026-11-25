/**
 * How often a scheduled job runs without the worker's cron: every minute,
 * every N minutes, hourly, or (anything with a fixed hour) daily.
 */
export function intervalMinutes(pattern: string): number {
  const [minute = "", hour = ""] = pattern.split(" ");
  if (minute === "*") return 1;
  const every = /^\*\/(\d+)$/.exec(minute);
  if (every) return Number(every[1]);
  return hour === "*" ? 60 : 1440;
}
