"use client";

import { useId, useState } from "react";

export type BarPoint = { key: string; label: string; value: number; display: string; detail?: string };

/**
 * A single-series column chart: thin bars from a zero baseline with rounded
 * tops, a recessive grid, a few date labels, and a tooltip on hover or focus.
 * The same numbers are in a table below it for screen readers and anyone who
 * prefers figures.
 */
export function BarChart({ points, title, valueLabel, height = 220 }: { points: BarPoint[]; title: string; valueLabel: string; height?: number }) {
  const id = useId();
  const [active, setActive] = useState<number | null>(null);
  const width = 720;
  const pad = { top: 12, right: 8, bottom: 28, left: 8 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((p) => p.value));
  const slot = plotW / Math.max(1, points.length);
  const gap = Math.min(2, slot * 0.25);
  const barW = Math.max(1, slot - gap);
  const r = Math.min(4, barW / 2);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  // Label roughly every seventh of the range, always the first and last.
  const every = Math.max(1, Math.ceil(points.length / 7));
  const hovered = active === null ? null : points[active];

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
          <title id={`${id}-t`}>{title}</title>
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <line key={f} x1={pad.left} x2={width - pad.right} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth={1} />
          ))}
          <line x1={pad.left} x2={width - pad.right} y1={y(0)} y2={y(0)} stroke="var(--input)" strokeWidth={1} />
          {points.map((p, i) => {
            const x = pad.left + i * slot + gap / 2;
            const top = y(p.value);
            const h = y(0) - top;
            return (
              <g key={p.key}>
                {h > 0 && (
                  <path
                    d={h > r ? `M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y(0)} Z` : `M${x},${y(0)} V${top} H${x + barW} V${y(0)} Z`}
                    fill="var(--primary)"
                    opacity={active === null || active === i ? 1 : 0.45}
                  />
                )}
                {/* The hit area is the whole column, not just the bar. */}
                <rect
                  x={pad.left + i * slot}
                  y={pad.top}
                  width={slot}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${p.label}: ${p.display}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none focus-visible:stroke-[var(--ring)]"
                />
                {(i % every === 0 || i === points.length - 1) && (
                  <text x={pad.left + i * slot + slot / 2} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--muted-foreground)">
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {hovered && active !== null && (
          <div
            role="status"
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: `${((pad.left + active * slot + slot / 2) / width) * 100}%` }}
          >
            <p className="font-semibold text-foreground">{hovered.label}</p>
            <p className="text-foreground">
              {valueLabel}: {hovered.display}
            </p>
            {hovered.detail && <p className="text-muted-foreground">{hovered.detail}</p>}
          </div>
        )}
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground">Show as a table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="py-1 pr-4 font-medium">Day</th>
                <th className="py-1 pr-4 font-medium">{valueLabel}</th>
                {points.some((p) => p.detail) && <th className="py-1 font-medium">Detail</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.key} className="border-b last:border-0">
                  <td className="py-1 pr-4">{p.label}</td>
                  <td className="py-1 pr-4 tabular-nums">{p.display}</td>
                  {p.detail !== undefined && <td className="py-1 text-muted-foreground">{p.detail}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
