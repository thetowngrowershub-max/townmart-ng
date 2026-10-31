/**
 * Overselling load test: BUYERS shoppers (default 50) race for STOCK units
 * (default 10) of one product, each in its own process with its own database
 * connection, released at the same instant. Then every order is paid through
 * the running app's webhook endpoint, each webhook delivered three times at
 * once, as providers sometimes do.
 *
 * Passes only if exactly STOCK orders were placed, every other buyer was told
 * it's out of stock, stock ends at zero, each order was paid once and the
 * ledger balances.
 *
 *   pnpm load:oversell                         # 50 buyers, 10 units, webhooks to APP_URL
 *   pnpm load:oversell --buyers 200 --stock 25
 *   pnpm load:oversell --no-webhooks           # database only, no running app needed
 *
 * Needs PAYMENT_PROVIDER=fake (the app and worker must use it too, with the
 * same AUTH_SECRET), and the app and worker running for the webhook part. It creates a test store and orders, so run it against a
 * development, CI or staging database, never production.
 */
import "dotenv/config";
import { fork } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import path from "node:path";
import { parseArgs } from "node:util";
import { prisma, withSystemContext } from "@/lib/db";
import { FakePaymentProvider } from "@/lib/payments/fake";
import { redis } from "@/lib/redis";
import type { BuyerResult } from "./buyer";

const { values } = parseArgs({
  options: {
    buyers: { type: "string", default: "50" },
    stock: { type: "string", default: "10" },
    "no-webhooks": { type: "boolean", default: false },
    "app-url": { type: "string", default: process.env.APP_URL ?? "http://localhost:3000" },
  },
});
const BUYERS = Number(values.buyers);
const STOCK = Number(values.stock);
const APP_URL = values["app-url"]!.replace(/\/$/, "");
const tag = `load-${randomUUID().slice(0, 8)}`;

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? "✓" : "✗"} ${what}`);
  if (!ok) failures.push(what);
};
const pct = (xs: number[], p: number) => xs.sort((x, y) => x - y)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

async function setup() {
  return withSystemContext(async (tx) => {
    const state = await tx.state.findUniqueOrThrow({ where: { code: "LA" } });
    const lga = await tx.lga.findFirstOrThrow({ where: { stateId: state.id, slug: "ikeja" } });
    const category = await tx.category.findFirstOrThrow({ where: { kind: "product", isActive: true, parentId: { not: null } } });
    const owner = await tx.user.create({ data: { email: `${tag}@test.townmart.local`, name: "Load test seller", roles: { create: [{ role: "customer" }, { role: "merchant" }] } } });
    const business = await tx.business.create({
      data: {
        ownerUserId: owner.id,
        type: "merchant",
        name: `Load test store ${tag}`,
        slug: tag,
        email: `${tag}@test.townmart.local`,
        phoneEncrypted: "v1.k1.load.load.load",
        phoneHash: tag,
        addressEncrypted: "v1.k1.load.load.load",
        city: "Ikeja",
        stateId: state.id,
        lgaId: lga.id,
        status: "approved",
        policy: { create: { deliveryOptions: { delivery: true, pickup: true } } },
      },
    });
    const product = await tx.product.create({ data: { businessId: business.id, categoryId: category.id, title: `Load test item ${tag}`, slug: `${tag}-item`, basePriceKobo: 150_000n, status: "active" } });
    const variant = await tx.productVariant.create({ data: { productId: product.id, businessId: business.id, sku: tag, priceKobo: 150_000n, stockQty: STOCK, isDefault: true } });
    const carts: string[] = [];
    for (let i = 0; i < BUYERS; i++) {
      const cart = await tx.cart.create({
        data: { guestTokenHash: `${tag}-${i}`, expiresAt: new Date(Date.now() + 3_600_000), items: { create: [{ variantId: variant.id, businessId: business.id, qty: 1 }] } },
      });
      carts.push(cart.id);
    }
    return { stateId: state.id, lgaId: lga.id, variantId: variant.id, businessId: business.id, carts };
  });
}

/** Starts every buyer, waits until all have a database connection, then releases them together. */
async function race(fixture: Awaited<ReturnType<typeof setup>>): Promise<BuyerResult[]> {
  const script = path.join(__dirname, "buyer.ts");
  const children = fixture.carts.map((cartId) => {
    const child = fork(script, { execArgv: ["--import", "tsx"], stdio: ["ignore", "inherit", "inherit", "ipc"] });
    const ready = new Promise<void>((resolve) => child.on("message", (m: { ready?: boolean }) => m.ready && resolve()));
    const result = new Promise<BuyerResult>((resolve) => {
      child.on("message", (m: { result?: BuyerResult }) => m.result && resolve(m.result));
      child.on("exit", (code) => resolve({ ok: false, code: "crashed", message: `buyer exited with ${code}`, ms: 0 }));
    });
    return { child, cartId, ready, result };
  });
  await Promise.all(children.map((c) => c.ready));
  console.log(`${BUYERS} buyers connected; go`);
  const started = Date.now();
  for (const c of children) c.child.send({ go: { cartId: c.cartId, stateId: fixture.stateId, lgaId: fixture.lgaId } });
  const results = await Promise.all(children.map((c) => c.result));
  console.log(`all buyers finished in ${Date.now() - started} ms`);
  return results;
}

async function payThroughWebhooks(placed: Extract<BuyerResult, { ok: true }>[]) {
  const secret = process.env.AUTH_SECRET!;
  await Promise.all(
    placed.map(async (p) => {
      await FakePaymentProvider.settle(p.reference, "success");
      const body = JSON.stringify({ id: `evt-${randomUUID()}`, event: "charge.success", reference: p.reference });
      const signature = createHmac("sha256", secret).update(body).digest("hex");
      const deliveries = await Promise.all(
        [1, 2, 3].map(() => fetch(`${APP_URL}/api/webhooks/fake`, { method: "POST", body, headers: { "content-type": "application/json", "x-fake-signature": signature } })),
      );
      if (deliveries.some((r) => r.status !== 200)) failures.push(`webhook for ${p.reference} answered ${deliveries.map((r) => r.status).join("/")}`);
    }),
  );
}

async function main() {
  if (process.env.PAYMENT_PROVIDER !== "fake") throw new Error("Set PAYMENT_PROVIDER=fake (here and in the app) to run the load test.");
  if (process.env.NODE_ENV === "production") throw new Error("The load test creates test orders; don't run it against production.");
  console.log(`Load test ${tag}: ${BUYERS} buyers, ${STOCK} units`);
  const fixture = await setup();
  const results = await race(fixture);

  const placed = results.filter((r): r is Extract<BuyerResult, { ok: true }> => r.ok);
  const refused = results.filter((r): r is Extract<BuyerResult, { ok: false }> => !r.ok);
  const times = results.map((r) => r.ms);
  console.log(`place order: p50 ${pct(times, 50).toFixed(0)} ms, p95 ${pct(times, 95).toFixed(0)} ms, max ${Math.max(...times).toFixed(0)} ms`);
  const unexpected = refused.filter((r) => r.code !== "out_of_stock");
  for (const r of unexpected.slice(0, 5)) console.log(`  unexpected refusal: ${r.code}: ${r.message}`);

  check(placed.length === STOCK, `${placed.length} orders placed for ${STOCK} units`);
  check(refused.length === BUYERS - STOCK && unexpected.length === 0, `${refused.length} buyers told it's out of stock (${unexpected.length} other errors)`);

  const variant = await withSystemContext((tx) => tx.productVariant.findUniqueOrThrow({ where: { id: fixture.variantId }, select: { stockQty: true } }));
  check(variant.stockQty.toNumber() === 0, `stock left: ${variant.stockQty.toString()}`);
  const items = await withSystemContext((tx) => tx.orderItem.aggregate({ where: { variantId: fixture.variantId }, _sum: { qty: true } }));
  check(Number(items._sum.qty ?? 0) === STOCK, `units on orders: ${items._sum.qty ?? 0}`);

  if (!values["no-webhooks"]) {
    await payThroughWebhooks(placed);
    const orderIds = placed.map((p) => p.orderId);
    // The app stores each webhook and the worker applies it: wait up to a minute.
    const paidOrders = () => withSystemContext((tx) => tx.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, paymentStatus: true } }));
    let orders = await paidOrders();
    for (let i = 0; i < 60 && orders.some((o) => o.paymentStatus !== "paid"); i++) {
      await new Promise((r) => setTimeout(r, 1000));
      orders = await paidOrders();
    }
    check(orders.length === STOCK && orders.every((o) => o.paymentStatus === "paid"), `${orders.filter((o) => o.paymentStatus === "paid").length} orders paid`);
    const txs = await withSystemContext((tx) => tx.ledgerTransaction.findMany({ where: { referenceId: { in: orderIds } }, include: { entries: true } }));
    check(txs.length === STOCK, `${txs.length} ledger transactions (one per order, despite ${STOCK * 3} webhook deliveries)`);
    const debits = txs.flatMap((t) => t.entries).reduce((n, e) => n + e.debitKobo, 0n);
    const credits = txs.flatMap((t) => t.entries).reduce((n, e) => n + e.creditKobo, 0n);
    check(debits === credits && debits > 0n, `ledger balances: debits ${debits} = credits ${credits} kobo`);
  }

  // Leave the store suspended so its listing never shows in search.
  await withSystemContext((tx) => tx.business.update({ where: { id: fixture.businessId }, data: { status: "suspended" } }));

  if (failures.length) {
    console.error(`\nLoad test FAILED: ${failures.length} check(s)`);
    process.exitCode = 1;
  } else {
    console.log("\nLoad test passed: no overselling");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  });
