import { withRls } from "@/lib/db";
import type { LocationOptions } from "@/components/storefront/search-filters";

/** States, plus the LGAs of the chosen state, for the filter form. */
export async function locationOptions(stateId?: number): Promise<LocationOptions> {
  return withRls({ userId: null }, async (tx) => ({
    states: await tx.state.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    lgas: stateId ? await tx.lga.findMany({ where: { stateId }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  }));
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
