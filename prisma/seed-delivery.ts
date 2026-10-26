/**
 * Default delivery zones and rates, and the global commission rule. These are
 * platform defaults (seeded in production too); admins edit them from the
 * console in Phase 7, and sellers can set their own rates per zone.
 *
 * Idempotent: zones are upserted by slug; a zone that already has default
 * rates keeps them; the global commission rule is created once.
 */
import type { PrismaClient } from "@prisma/client";

const naira = (n: number) => BigInt(n * 100);

/** Weight bands (grams): [0, 2kg), [2kg, 10kg), [10kg, 30kg), 30kg and up. */
const BANDS: [number, number | null][] = [
  [0, 2_000],
  [2_000, 10_000],
  [10_000, 30_000],
  [30_000, null],
];

type ZoneSeed = { slug: string; name: string; priority: number; states?: string[]; lgas?: { state: string; names: string[] }; fees: [number, number, number, number]; freeOver?: number; eta: [number, number] };

const SOUTH_WEST = ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"];
const SOUTH = ["Rivers", "Delta", "Edo", "Akwa Ibom", "Cross River", "Bayelsa", "Anambra", "Enugu", "Imo", "Abia", "Ebonyi"];
const NORTH = ["Adamawa", "Bauchi", "Benue", "Borno", "Gombe", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Nasarawa", "Niger", "Plateau", "Sokoto", "Taraba", "Yobe", "Zamfara"];

const ZONES: ZoneSeed[] = [
  {
    slug: "lagos-central",
    name: "Central Lagos",
    priority: 10,
    lgas: {
      state: "Lagos",
      names: ["Ikeja", "Lagos Mainland", "Surulere", "Mushin", "Oshodi-Isolo", "Shomolu", "Kosofe", "Agege", "Ifako-Ijaiye", "Lagos Island", "Eti Osa", "Apapa", "Amuwo-Odofin", "Ajeromi-Ifelodun"],
    },
    fees: [1_500, 2_500, 4_000, 7_000],
    freeOver: 50_000,
    eta: [1, 2],
  },
  { slug: "lagos", name: "Lagos", priority: 50, states: ["Lagos"], fees: [2_500, 3_500, 5_500, 9_000], freeOver: 75_000, eta: [1, 3] },
  { slug: "south-west", name: "South West", priority: 100, states: SOUTH_WEST, fees: [3_500, 5_000, 8_000, 12_000], eta: [2, 4] },
  { slug: "abuja", name: "Abuja (FCT)", priority: 100, states: ["FCT Abuja"], fees: [4_500, 6_500, 10_000, 15_000], eta: [2, 5] },
  { slug: "south-south-east", name: "South South and South East", priority: 100, states: SOUTH, fees: [4_500, 6_500, 10_000, 15_000], eta: [3, 5] },
  { slug: "north", name: "North", priority: 100, states: NORTH, fees: [5_500, 8_000, 12_000, 18_000], eta: [3, 7] },
];

export async function seedDeliveryAndCommission(prisma: PrismaClient) {
  const states = await prisma.state.findMany({ select: { id: true, name: true } });
  const stateId = (name: string) => {
    const s = states.find((x) => x.name === name);
    if (!s) throw new Error(`Unknown state ${name}`);
    return s.id;
  };
  let created = 0;
  for (const z of ZONES) {
    const lgaIds = z.lgas
      ? (await prisma.lga.findMany({ where: { stateId: stateId(z.lgas.state), name: { in: z.lgas.names } }, select: { id: true } })).map((l) => l.id)
      : [];
    if (z.lgas && lgaIds.length !== z.lgas.names.length) throw new Error(`Some LGAs for ${z.name} weren't found`);
    const stateIds = (z.states ?? []).map(stateId);
    const zone = await prisma.deliveryZone.upsert({
      where: { slug: z.slug },
      update: {},
      create: { slug: z.slug, name: z.name, priority: z.priority, stateIds, lgaIds },
    });
    if ((await prisma.deliveryRate.count({ where: { zoneId: zone.id, businessId: null } })) === 0) {
      await prisma.deliveryRate.createMany({
        data: BANDS.map(([min, max], i) => ({
          zoneId: zone.id,
          minWeightG: min,
          maxWeightG: max,
          feeKobo: naira(z.fees[i]!),
          freeOverKobo: z.freeOver ? naira(z.freeOver) : null,
          etaDaysMin: z.eta[0],
          etaDaysMax: z.eta[1],
        })),
      });
      created++;
    }
  }
  console.log(`✓ ${ZONES.length} delivery zones (${created} given default rates)`);

  if ((await prisma.commissionRule.count({ where: { scope: "global" } })) === 0) {
    const setting = await prisma.setting.findUnique({ where: { key: "commission.default_percent" } });
    const percent = typeof setting?.value === "number" ? setting.value : 5;
    await prisma.commissionRule.create({ data: { scope: "global", percentBps: Math.round(percent * 100), effectiveFrom: new Date("2026-01-01T00:00:00Z") } });
    console.log(`✓ Global commission rule (${percent}%)`);
  }
}
