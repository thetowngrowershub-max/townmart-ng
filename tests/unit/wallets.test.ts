import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBalanced, payoutPostings, payoutReturnedPostings, riderEarningPostings } from "@/lib/ledger/entries";
import { flutterwaveRecipient } from "@/lib/payments/banks";
import { FlutterwaveTransfers, recipientUsable } from "@/lib/payments/transfers";

/**
 * Wallets and payouts: rider earnings split the delivery fee exactly,
 * Flutterwave transfers go to the sealed bank account in naira and never
 * send twice, and bank accounts saved with another provider can't be paid.
 */

// Before anything reads the environment (it's cached).
process.env.BANK_VERIFIER = "fake";

afterEach(() => vi.unstubAllGlobals());

describe("rider earnings", () => {
  it("moves the whole delivery fee off the seller: the rider's share to their wallet, the rest to TownMart", () => {
    const postings = riderEarningPostings({ businessId: "b1", from: "escrow", riderId: "r1", deliveryKobo: 150_000n, riderPayKobo: 120_000n });
    assertBalanced(postings);
    expect(postings).toEqual([
      { account: { ownerType: "business", businessId: "b1", type: "escrow" }, debitKobo: 150_000n, creditKobo: 0n },
      { account: { ownerType: "rider", riderId: "r1", type: "available" }, debitKobo: 0n, creditKobo: 120_000n },
      { account: { ownerType: "platform", type: "commission" }, debitKobo: 0n, creditKobo: 30_000n },
    ]);
    // All of it to the rider: no TownMart line.
    expect(riderEarningPostings({ businessId: "b1", from: "available", riderId: "r1", deliveryKobo: 50_000n, riderPayKobo: 50_000n })).toHaveLength(2);
    expect(() => riderEarningPostings({ businessId: "b1", from: "escrow", riderId: "r1", deliveryKobo: 50_000n, riderPayKobo: 60_000n })).toThrow(/between 0 and the delivery fee/);
  });

  it("pays a rider's wallet out and back like a shop's balance", () => {
    const out = payoutPostings({ kind: "rider", id: "r1" }, "flutterwave", 9_000n);
    expect(out[0]).toMatchObject({ account: { ownerType: "rider", riderId: "r1" }, debitKobo: 9_000n });
    expect(payoutReturnedPostings({ kind: "rider", id: "r1" }, "flutterwave", 9_000n)[1]).toMatchObject({ account: { ownerType: "rider", riderId: "r1" }, creditKobo: 9_000n });
    // Shops by id still work (the old call shape).
    expect(payoutPostings("b1", "fake", 1n)[0]).toMatchObject({ account: { ownerType: "business", businessId: "b1", type: "available" } });
  });
});

describe("Flutterwave payouts", () => {
  const sealed = flutterwaveRecipient.seal("058", "0123456789");

  it("seals the bank account so only the last 4 digits are readable in the database", () => {
    expect(sealed.startsWith("flw:")).toBe(true);
    expect(sealed).not.toContain("0123456789");
    expect(flutterwaveRecipient.open(sealed)).toEqual({ bankCode: "058", accountNumber: "0123456789" });
    expect(flutterwaveRecipient.open("RCP_abc")).toBeNull();
    expect(flutterwaveRecipient.open("flw:garbage")).toBeNull();
  });

  it("sends the transfer in naira with our reference, and reads NEW as on its way", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      Response.json({ status: "success", message: "Transfer Queued Successfully", data: { id: 4321, status: "NEW", reference: "PO-1-ABC" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await new FlutterwaveTransfers("FLWSECK_TEST-x").send({ reference: "PO-1-ABC", amountKobo: 1_234_550n, recipientCode: sealed, reason: "TownMart payout PO-1-ABC" });
    expect(r).toMatchObject({ status: "processing", transferCode: "4321" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.flutterwave.com/v3/transfers");
    expect(JSON.parse(String(init!.body))).toMatchObject({ account_bank: "058", account_number: "0123456789", amount: 12345.5, currency: "NGN", reference: "PO-1-ABC" });
  });

  it("looks a transfer up by reference before giving up on an error, so a retry never pays twice", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ status: "error", message: "Duplicate reference", data: null }, { status: 400 }))
      .mockResolvedValueOnce(Response.json({ status: "success", message: "ok", data: [{ id: 99, status: "SUCCESSFUL", reference: "PO-2" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await new FlutterwaveTransfers("k").send({ reference: "PO-2", amountKobo: 100n, recipientCode: sealed, reason: "x" });
    expect(r).toMatchObject({ status: "paid", transferCode: "99" });
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/transfers?reference=PO-2");
  });

  it("reports a failed transfer with Flutterwave's reason, and refuses an account saved for another provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "success", message: "ok", data: [{ id: 5, status: "FAILED", reference: "PO-3", complete_message: "Account resolve failed" }] })));
    expect(await new FlutterwaveTransfers("k").verify("PO-3")).toMatchObject({ status: "failed", message: "Account resolve failed" });
    expect(await new FlutterwaveTransfers("k").send({ reference: "PO-4", amountKobo: 100n, recipientCode: "RCP_paystack", reason: "x" })).toMatchObject({ status: "failed" });
  });

  it("only pays bank accounts registered with the current payout provider", () => {
    const at = new Date();
    expect(recipientUsable({ providerRecipientCode: "RCP_test_1234", recipientProvider: null, verifiedAt: at })).toBe(true);
    expect(recipientUsable({ providerRecipientCode: sealed, recipientProvider: "flutterwave", verifiedAt: at })).toBe(false);
    expect(recipientUsable({ providerRecipientCode: "RCP_test_1234", recipientProvider: "fake", verifiedAt: null })).toBe(false);
    expect(recipientUsable(null)).toBe(false);
  });
});
