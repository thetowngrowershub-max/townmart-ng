import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { canonicalTown, isAreaTown, SERVICE_AREA_LABEL, SERVICE_AREAS, type AreaState } from "@/lib/service-area";

/** Prisma filter for an LGA inside the service area. Use as `lga: IN_SERVICE_AREA` on a business or address. */
export const IN_SERVICE_AREA: Prisma.LgaWhereInput = {
  OR: SERVICE_AREAS.map((a) => ({ slug: a.lgaSlug, state: { slug: a.stateSlug } })),
};

/** SQL condition: `<lgaColumn>` is an LGA inside the service area. */
export function inServiceAreaSql(lgaColumn: string): Prisma.Sql {
  const pairs = Prisma.join(SERVICE_AREAS.map((a) => Prisma.sql`(${a.stateSlug}, ${a.lgaSlug})`));
  return Prisma.sql`${Prisma.raw(lgaColumn)} IN (
    SELECT sa_l.id FROM lgas sa_l JOIN states sa_s ON sa_s.id = sa_l.state_id
     WHERE (sa_s.slug, sa_l.slug) IN (${pairs}))`;
}

/** The states and LGAs people can choose in location forms: only the service area. */
export async function serviceAreaOptions(tx: Tx): Promise<AreaState[]> {
  const lgas = await tx.lga.findMany({
    where: IN_SERVICE_AREA,
    orderBy: [{ state: { name: "asc" } }, { name: "asc" }],
    select: { id: true, name: true, slug: true, state: { select: { id: true, name: true, slug: true } } },
  });
  const states = new Map<number, AreaState>();
  for (const l of lgas) {
    const area = SERVICE_AREAS.find((a) => a.stateSlug === l.state.slug && a.lgaSlug === l.slug);
    const s = states.get(l.state.id) ?? { id: l.state.id, name: l.state.name, lgas: [] };
    s.lgas.push({ id: l.id, name: l.name, towns: [...(area?.towns ?? [])] });
    states.set(l.state.id, s);
  }
  return [...states.values()];
}

export type AreaCheck =
  | { ok: true; city: string }
  | { ok: false; error: string; fieldErrors: Partial<Record<"stateId" | "lgaId" | "city", string[]>> };

/**
 * Checks a state, LGA and town are inside the service area, and that the LGA
 * belongs to the state. Returns the town spelled as the area lists it.
 */
export async function checkServiceArea(tx: Tx, place: { stateId: number; lgaId: number; city: string }): Promise<AreaCheck> {
  const lga = await tx.lga.findUnique({ where: { id: place.lgaId }, select: { stateId: true, slug: true, state: { select: { slug: true } } } });
  if (!lga || lga.stateId !== place.stateId) {
    return { ok: false, error: "Choose an LGA in the selected state.", fieldErrors: { lgaId: ["Not in this state"] } };
  }
  const area = SERVICE_AREAS.find((a) => a.stateSlug === lga.state.slug && a.lgaSlug === lga.slug);
  if (!area) {
    return { ok: false, error: `TownMart is only open in ${SERVICE_AREA_LABEL} for now.`, fieldErrors: { lgaId: [`Only ${SERVICE_AREA_LABEL} for now`] } };
  }
  if (!isAreaTown(area.towns, place.city)) {
    const towns = area.towns.join(", ");
    return { ok: false, error: `TownMart is only open in ${towns} for now.`, fieldErrors: { city: [`Choose ${towns}`] } };
  }
  return { ok: true, city: canonicalTown(area.towns, place.city) };
}
