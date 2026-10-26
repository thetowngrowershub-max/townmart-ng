/** Status history, oldest first, as a vertical timeline. */
export function OrderTimeline({ events }: { events: { label: string; note: string | null; at: string }[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No updates yet.</p>;
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5 text-sm">
      {events.map((e, i) => (
        <li key={i} className="relative">
          <span className={`absolute top-1 -left-[25px] size-2.5 rounded-full ring-4 ring-card ${i === events.length - 1 ? "bg-primary" : "bg-muted-foreground/40"}`} aria-hidden />
          <p className="font-medium">{e.label}</p>
          {e.note && <p className="text-muted-foreground">{e.note}</p>}
          <p className="text-xs text-muted-foreground">{e.at}</p>
        </li>
      ))}
    </ol>
  );
}
