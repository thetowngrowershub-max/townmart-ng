import { afterEach, describe, expect, it, vi } from "vitest";
import { maskRecipient } from "@/lib/notifications/delivery-log";
import { TermiiSmsProvider, termiiHint } from "@/lib/notifications/sms";
import { signUpSchema } from "@/lib/validation/auth";

vi.mock("@/lib/redis", () => ({ redis: {} }));

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("Termii texts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends on the chosen route, without the plus sign", async () => {
    const fetchMock = vi.fn(async () => reply(200, { code: "ok", message_id: 9_012, message: "Successfully Sent" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await new TermiiSmsProvider("key", "TownMart", "https://v3.api.termii.com", "generic").send({ to: "+2348031234567", body: "hi" });
    expect(res.id).toBe("9012");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://v3.api.termii.com/api/sms/send");
    expect(JSON.parse(init.body as string)).toMatchObject({ to: "2348031234567", from: "TownMart", channel: "generic", type: "plain" });
  });

  it("treats a 200 with no message id as a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { message: "Insufficient balance" })));
    await expect(new TermiiSmsProvider("key", "TownMart", "https://x.test", "dnd").send({ to: "+2348031234567", body: "hi" })).rejects.toThrow(/top up the Termii wallet/);
  });

  it("explains the common setup errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { message: "ApplicationSenderId not found" })));
    await expect(new TermiiSmsProvider("key", "TownMart", "https://x.test", "dnd").send({ to: "+2348031234567", body: "hi" })).rejects.toThrow(/sender ID isn't approved/);
    expect(termiiHint("Kindly contact support to activate DND route")).toMatch(/TERMII_CHANNEL=generic/);
    expect(termiiHint("Something else")).toBe("Something else");
  });
});

describe("message log", () => {
  it("masks recipients", () => {
    expect(maskRecipient("sms", "+2348031234567")).toBe("0803 ••• ••67");
    expect(maskRecipient("email", "bola@example.com")).toBe("b•••@example.com");
    expect(maskRecipient("email", "Bola <bola@example.com>")).toBe("b•••@example.com");
  });
});

describe("sign-up phone", () => {
  const base = { name: "Bola Ade", email: "bola@example.com", password: "a-long-password", acceptTerms: true as const };
  it("is optional", () => {
    expect(signUpSchema.parse(base).phone).toBeUndefined();
    expect(signUpSchema.parse({ ...base, phone: "" }).phone).toBeUndefined();
  });
  it("is normalised to +234", () => {
    expect(signUpSchema.parse({ ...base, phone: "0803 123 4567" }).phone).toBe("+2348031234567");
  });
  it("must be a Nigerian mobile", () => {
    expect(signUpSchema.safeParse({ ...base, phone: "12345" }).success).toBe(false);
  });
});
