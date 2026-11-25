import { withRls } from "@/lib/db";
import type { LocationOptions } from "@/components/storefront/search-filters";
import { serviceAreaOptions } from "@/lib/service-area-db";

/**
 * The service area's states, plus the LGAs of the chosen state, for the filter
 * form. Places outside the service area aren't offered: nothing is listed there.
 */
export async function locationOptions(stateId?: number): Promise<LocationOptions> {
  const area = await withRls({ userId: null }, (tx) => serviceAreaOptions(tx));
  const lgaCount = area.reduce((n, s) => n + s.lgas.length, 0);
  const chosen = area.find((s) => s.id === stateId) ?? (area.length === 1 ? area[0] : undefined);
  return {
    states: area.map(({ id, name }) => ({ id, name })),
    lgas: chosen?.lgas.map(({ id, name }) => ({ id, name })) ?? [],
    singlePlace: lgaCount <= 1,
  };
}

/** Rebuilds a URL from search params with some keys replaced. */
export function withParams(path: string, current: Record<string, string | string[] | undefined>, changes: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...current, ...changes })) {
    const val = Array.isArray(v) ? v[0] : v;
    if (val) p.set(k, val);
  }
  const s = p.toString();
  return s ? `${path}?${s}` : path;
}
