import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, withRls } from "@/lib/db";
import { createAddress, createUser, deleteUsers, lagosIkeja, owner } from "./helpers";

let alice: { id: string };
let bob: { id: string };
let aliceAddress: { id: string };
let bobAddress: { id: string };

beforeAll(async () => {
  alice = await createUser("alice");
  bob = await createUser("bob");
  aliceAddress = await createAddress(alice.id);
  bobAddress = await createAddress(bob.id);
});

afterAll(async () => {
  await deleteUsers(alice.id, bob.id);
  await owner.$disconnect();
  await prisma.$disconnect();
});

describe("RLS: addresses are visible only to their owner", () => {
  it("returns only the current user's rows", async () => {
    const rows = await withRls({ userId: alice.id }, (tx) => tx.address.findMany({ where: { id: { in: [aliceAddress.id, bobAddress.id] } } }));
    expect(rows.map((r) => r.id)).toEqual([aliceAddress.id]);
  });

  it("hides another user's row even when queried by id", async () => {
    const row = await withRls({ userId: alice.id }, (tx) => tx.address.findUnique({ where: { id: bobAddress.id } }));
    expect(row).toBeNull();
  });

  it("returns nothing without an RLS context", async () => {
    const rows = await prisma.address.findMany({ where: { id: { in: [aliceAddress.id, bobAddress.id] } } });
    expect(rows).toEqual([]);
  });

  it("can't update or delete another user's row", async () => {
    const updated = await withRls({ userId: alice.id }, (tx) =>
      tx.address.updateMany({ where: { id: bobAddress.id }, data: { label: "hijacked" } }),
    );
    const deleted = await withRls({ userId: alice.id }, (tx) => tx.address.deleteMany({ where: { id: bobAddress.id } }));
    expect(updated.count).toBe(0);
    expect(deleted.count).toBe(0);
    const still = await owner.address.findUniqueOrThrow({ where: { id: bobAddress.id } });
    expect(still.label).toBe("Home");
  });

  it("can't insert a row for another user", async () => {
    const { stateId, lgaId } = await lagosIkeja();
    await expect(
      withRls({ userId: alice.id }, (tx) =>
        tx.address.create({
          data: { userId: bob.id, recipientName: "x", phoneEncrypted: "x", line1Encrypted: "x", city: "Ikeja", stateId, lgaId },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("can't move its own row to another user", async () => {
    await expect(
      withRls({ userId: alice.id }, (tx) => tx.address.update({ where: { id: aliceAddress.id }, data: { userId: bob.id } })),
    ).rejects.toThrow(/row-level security/);
  });

  it("lets the admin scope see all rows", async () => {
    const rows = await withRls({ scope: "admin", userId: alice.id }, (tx) =>
      tx.address.findMany({ where: { id: { in: [aliceAddress.id, bobAddress.id] } } }),
    );
    expect(rows).toHaveLength(2);
  });

  it("does not leak context between transactions on the same pool", async () => {
    await withRls({ userId: alice.id }, (tx) => tx.address.count());
    const rows = await prisma.$queryRaw<{ uid: string | null }[]>`SELECT app_current_user_id()::text AS uid`;
    expect(rows[0]?.uid).toBeNull();
  });
});

describe("RLS: user_roles", () => {
  it("lets a user read only their own roles", async () => {
    const roles = await withRls({ userId: alice.id }, (tx) => tx.userRole.findMany({ where: { userId: { in: [alice.id, bob.id] } } }));
    expect(roles.every((r) => r.userId === alice.id)).toBe(true);
    expect(roles).toHaveLength(1);
  });

  it("blocks self-promotion to admin", async () => {
    await expect(
      withRls({ userId: alice.id }, (tx) => tx.userRole.create({ data: { userId: alice.id, role: "admin" } })),
    ).rejects.toThrow(/row-level security/);
  });

  it("blocks granting roles to someone else", async () => {
    await expect(
      withRls({ userId: alice.id }, (tx) => tx.userRole.create({ data: { userId: bob.id, role: "customer" } })),
    ).rejects.toThrow(/row-level security/);
  });

  it("blocks a user deleting their own role rows", async () => {
    const { count } = await withRls({ userId: alice.id }, (tx) => tx.userRole.deleteMany({ where: { userId: alice.id } }));
    expect(count).toBe(0);
  });
});
