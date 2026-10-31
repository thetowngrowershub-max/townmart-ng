import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hashPassword } from "@/lib/auth/password";
import { prisma, withSystemContext } from "@/lib/db";
import { redis } from "@/lib/redis";
import { FIXTURES_FILE, type E2EFixtures } from "./fixtures";

/**
 * Gives the demo sellers and a test customer a known password and tops up the
 * test product's stock, then writes what the tests need to FIXTURES_FILE.
 * Needs the development seed (pnpm db:seed with demo data) and refuses to run
 * against production.
 */
export default async function globalSetup() {
  if (process.env.NODE_ENV === "production") throw new Error("The E2E tests change passwords and stock; never run them against production.");
  if (process.env.PAYMENT_PROVIDER !== "fake") throw new Error("Run the E2E tests with PAYMENT_PROVIDER=fake (in the app and worker too).");
  const password = `e2e-${Math.random().toString(36).slice(2)}-Pass`;
  const passwordHash = await hashPassword(password);
  const signInReady = { passwordHash, emailVerified: new Date(), twoFactorEnabledAt: null, failedLoginCount: 0, lockedUntil: null };

  try {
    const fixtures = await withSystemContext(async (tx): Promise<E2EFixtures> => {
      const shop = await tx.business.findUniqueOrThrow({ where: { slug: "cv-gadget-hub" }, include: { owner: true } });
      const product = await tx.product.findFirstOrThrow({ where: { businessId: shop.id, slug: { startsWith: "tempered-glass-screen-protector" }, status: "active" }, include: { variants: true } });
      await tx.productVariant.updateMany({ where: { productId: product.id }, data: { stockQty: 500 } });
      await tx.user.update({ where: { id: shop.ownerUserId }, data: signInReady });

      const provider = await tx.business.findUniqueOrThrow({ where: { slug: "chukwudi-fixit-plumbing" }, include: { owner: true } });
      const service = await tx.service.findFirstOrThrow({ where: { businessId: provider.id, slug: { startsWith: "pumping-machine-repair" }, status: "active" } });
      await tx.user.update({ where: { id: provider.ownerUserId }, data: signInReady });

      const email = "e2e-customer@test.townmart.local";
      const customer = await tx.user.upsert({
        where: { email },
        update: signInReady,
        create: { email, name: "Ada Okafor", ...signInReady, roles: { create: [{ role: "customer" }] } },
      });
      // Start from an empty cart, whatever an interrupted run left behind.
      await tx.cart.deleteMany({ where: { userId: customer.id } });

      const admin = await tx.user.update({ where: { email: "admin@townmart.local" }, data: signInReady });

      return {
        password,
        admin: { email: admin.email },
        customer: { email, name: "Ada Okafor" },
        seller: { email: shop.owner.email, shopName: shop.name },
        product: { slug: product.slug, title: product.title },
        provider: { email: provider.owner.email, name: provider.name },
        service: { slug: service.slug, title: service.title },
      };
    });
    // Sign-in rate limits would trip over repeated local runs.
    const keys = await redis.keys("rl:*");
    if (keys.length) await redis.del(...keys);
    mkdirSync(path.dirname(FIXTURES_FILE), { recursive: true });
    writeFileSync(FIXTURES_FILE, JSON.stringify(fixtures, null, 2));
  } finally {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  }
}
