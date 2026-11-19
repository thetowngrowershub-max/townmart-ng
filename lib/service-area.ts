/**
 * Where TownMart operates. Sellers can only register a business here, shoppers
 * can only save delivery addresses here, and the storefront only lists shops
 * and providers based here.
 *
 * To open a new area, add an entry. `stateSlug` and `lgaSlug` must match the
 * seeded reference data (prisma/data/nigeria-states-lgas.json, slugified, so
 * "Obafemi Owode" is "obafemi-owode"). `towns` are the towns or cities people
 * can pick inside that LGA; an empty list lets them type any town.
 *
 * Safe to import from client components: no database access here.
 */
export type ServiceAreaConfig = {
  /** How the area is named to people, e.g. on the storefront and in error messages. */
  label: string;
  stateSlug: string;
  lgaSlug: string;
  towns: readonly string[];
  /**
   * The middle of the area, roughly. Delivery is priced from here when a
   * shopper hasn't shared their location or pinned their address.
   */
  centre: { lat: number; lng: number };
};

export const SERVICE_AREAS: readonly ServiceAreaConfig[] = [
  { label: "Mowe, Obafemi-Owode, Ogun State", stateSlug: "ogun", lgaSlug: "obafemi-owode", towns: ["Mowe"], centre: { lat: 6.809, lng: 3.437 } },
];

/** Where TownMart works, in words: "Mowe, Obafemi-Owode, Ogun State". */
export const SERVICE_AREA_LABEL = SERVICE_AREAS.map((a) => a.label).join("; ");

/** A state the marketplace operates in, with its LGAs and their towns, as forms show them. */
export type AreaState = { id: number; name: string; lgas: AreaLga[] };
export type AreaLga = { id: number; name: string; towns: string[] };

/** True when `city` is one of the LGA's towns, ignoring case and spacing. Any town passes when the LGA lists none. */
export function isAreaTown(towns: readonly string[], city: string): boolean {
  if (towns.length === 0) return city.trim().length > 0;
  const c = city.trim().toLowerCase().replace(/\s+/g, " ");
  return towns.some((t) => t.toLowerCase() === c);
}

/** The town as written in the area list, so stored values are consistent ("mowe " becomes "Mowe"). */
export function canonicalTown(towns: readonly string[], city: string): string {
  const c = city.trim().toLowerCase().replace(/\s+/g, " ");
  return towns.find((t) => t.toLowerCase() === c) ?? city.trim();
}

/** The centre of the area an LGA belongs to, matched by slugs; null outside the service area. */
export function areaCentre(stateSlug: string, lgaSlug: string): { lat: number; lng: number } | null {
  return SERVICE_AREAS.find((a) => a.stateSlug === stateSlug && a.lgaSlug === lgaSlug)?.centre ?? null;
}
