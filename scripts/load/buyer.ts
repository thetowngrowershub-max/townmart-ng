/**
 * One buyer in the overselling load test (scripts/load/oversell.ts). Runs in
 * its own process with its own database connection, like a separate app
 * server, and goes through the same code as the checkout action: price the
 * cart, place the order, start the payment.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { computeCheckout } from "@/lib/checkout/compute";
import { prisma, withSystemContext } from "@/lib/db";
import { OrderError, placeOrder } from "@/lib/orders/place";
import { startOnlinePayment } from "@/lib/orders/payment";
import { redis } from "@/lib/redis";

type Go = { cartId: string; stateId: number; lgaId: number };
export type BuyerResult =
  | { ok: true; orderId: string; ms: number; reference: string }
  | { ok: false; code: string; message: string; ms: number };

const send = (m: unknown) => new Promise<void>((resolve) => process.send!(m, () => resolve()));

async function buy({ cartId, stateId, lgaId }: Go): Promise<BuyerResult> {
  const address = { recipientName: "Load Test", phone: "08031234567", line1: "1 Test Road", line2: "", landmark: "", city: "Ikeja", stateId, lgaId };
  const started = performance.now();
  try {
    const quote = await withSystemContext((tx) => computeCheckout(tx, { cartId, userId: null, address: { stateId, lgaId } }));
    const placed = await withSystemContext(
      (tx) =>
        placeOrder(tx, {
          cartId,
          userId: null,
          accountEmail: null,
          accountName: null,
          ipHash: "load-test",
          data: {
            email: `load-${randomUUID()}@test.townmart.local`,
            address,
            addressId: "",
            saveAddress: false,
            methods: {},
            payment: "online",
            acceptTerms: true,
            marketingConsent: false,
            expectedTotalKobo: quote.quote.totalKobo.toString(),
          },
        }),
      { timeout: 60_000, maxWait: 60_000 },
    );
    await startOnlinePayment(placed.orderId, placed.accessToken);
    const payment = await withSystemContext((tx) => tx.payment.findFirstOrThrow({ where: { orderId: placed.orderId }, select: { providerReference: true } }));
    return { ok: true, orderId: placed.orderId, ms: performance.now() - started, reference: payment.providerReference };
  } catch (err) {
    const code = err instanceof OrderError ? err.code : "error";
    return { ok: false, code, message: err instanceof Error ? err.message : String(err), ms: performance.now() - started };
  }
}

process.on("message", async (m: { go?: Go }) => {
  if (!m.go) return;
  const result = await buy(m.go);
  await send({ result });
  await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
  process.exit(0);
});

// Open the connection first, so the race starts when the orchestrator says go.
prisma
  .$queryRaw`SELECT 1`
  .then(() => send({ ready: true }))
  .catch(async (err) => {
    await send({ result: { ok: false, code: "connect", message: String(err), ms: 0 } });
    process.exit(1);
  });
