import { afterAll, describe, expect, it } from "vitest";
import { writeAudit } from "@/lib/audit";
import { prisma, withRls, withSystemContext } from "@/lib/db";
import { createUser, deleteUsers, owner } from "./helpers";

afterAll(async () => {
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("database roles", () => {
  it("connects the app as a non-superuser that cannot bypass RLS", async () => {
    const [role] = await prisma.$queryRaw<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolname: "townmart_app", rolsuper: false, rolbypassrls: false });
  });

  it("does not let the app own any table (owners bypass RLS)", async () => {
    const owned = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'townmart_app'`;
    expect(owned[0]!.n).toBe(0n);
  });

  it("keeps reference data read-only for the app", async () => {
    await expect(prisma.state.create({ data: { code: "XX", name: "Nowhere", slug: "nowhere" } })).rejects.toThrow(/permission denied/);
    await expect(prisma.lga.updateMany({ data: { name: "x" } })).rejects.toThrow(/permission denied/);
  });
});

describe("audit_logs is append-only", () => {
  it("allows inserts and blocks UPDATE/DELETE for the app", async () => {
    const entry = await withSystemContext((tx) => tx.auditLog.create({ data: { action: "test.append", entityType: "test" } }));
    await expect(
      withSystemContext((tx) => tx.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })),
    ).rejects.toThrow(/permission denied/);
    await expect(withSystemContext((tx) => tx.auditLog.delete({ where: { id: entry.id } }))).rejects.toThrow(/permission denied/);
  });

  it("blocks UPDATE/DELETE even for the table owner", async () => {
    const entry = await owner.auditLog.create({ data: { action: "test.owner", entityType: "test" } });
    await expect(owner.auditLog.update({ where: { id: entry.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(owner.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    await expect(owner.$executeRawUnsafe("TRUNCATE audit_logs")).rejects.toThrow(/append-only/);
  });

  it("lets an ordinary user append through writeAudit without being able to read it back", async () => {
    const user = await createUser("auditor");
    await withRls({ userId: user.id }, (tx) => writeAudit(tx, { actorUserId: user.id, action: "test.user_append", entityType: "test" }));
    const mine = await withRls({ userId: user.id }, (tx) => tx.auditLog.findMany({ where: { actorUserId: user.id } }));
    const all = await withSystemContext((tx) => tx.auditLog.findMany({ where: { actorUserId: user.id } }));
    expect(mine).toEqual([]);
    expect(all).toHaveLength(1);
    await deleteUsers(user.id);
  });

  it("is readable only in admin/system scope", async () => {
    const entry = await withSystemContext((tx) => tx.auditLog.create({ data: { action: "test.read", entityType: "test" } }));
    const asUser = await withRls({ userId: null }, (tx) => tx.auditLog.findUnique({ where: { id: entry.id } }));
    const asSystem = await withSystemContext((tx) => tx.auditLog.findUnique({ where: { id: entry.id } }));
    expect(asUser).toBeNull();
    expect(asSystem?.id).toBe(entry.id);
  });
});

describe("conventions", () => {
  it("attaches the updated_at trigger to every table with updated_at", async () => {
    const missing = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger tg
          WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass AND tg.tgname = 'trg_set_updated_at'
        )`;
    expect(missing).toEqual([]);
  });

  it("indexes every foreign key", async () => {
    const unindexed = await prisma.$queryRaw<{ constraint: string }[]>`
      SELECT con.conname AS constraint
      FROM pg_constraint con
      WHERE con.contype = 'f' AND con.connamespace = 'public'::regnamespace
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          WHERE i.indrelid = con.conrelid
            AND (i.indkey::int2[])[0:cardinality(con.conkey) - 1] @> con.conkey
        )`;
    expect(unindexed).toEqual([]);
  });

  it("maintains updated_at on raw SQL updates", async () => {
    const user = await createUser("trigger");
    await owner.$executeRaw`UPDATE users SET updated_at = '2000-01-01' WHERE id = ${user.id}::uuid`;
    // The trigger overrides any value written explicitly.
    const after = await owner.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.updatedAt.getFullYear()).toBeGreaterThan(2000);
    await deleteUsers(user.id);
  });

  it("generates time-ordered UUID v7 primary keys", async () => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT uuid_generate_v7()::text AS id FROM generate_series(1, 50)`;
    const ids = rows.map((r) => r.id);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const ms = (id: string) => parseInt(id.replace(/-/g, "").slice(0, 12), 16);
    expect(Math.abs(ms(ids[0]!) - Date.now())).toBeLessThan(60_000);
    expect(ids.map(ms)).toEqual([...ids.map(ms)].sort((a, b) => a - b));
  });

  it("seeds 36 states + FCT and 774 LGAs", async () => {
    expect(await prisma.state.count()).toBe(37);
    expect(await prisma.lga.count()).toBe(774);
  });

  it("rejects an address whose LGA is in a different state", async () => {
    const user = await createUser("lga-check");
    const lagos = await owner.state.findUniqueOrThrow({ where: { code: "LA" } });
    const kanoLga = await owner.lga.findFirstOrThrow({ where: { state: { code: "KN" } } });
    await expect(
      owner.address.create({
        data: { userId: user.id, recipientName: "x", phoneEncrypted: "x", line1Encrypted: "x", city: "x", stateId: lagos.id, lgaId: kanoLga.id },
      }),
    ).rejects.toThrow(/addresses_lga_in_state/);
    await deleteUsers(user.id);
  });
});
