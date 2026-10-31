import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const FIXTURES_FILE = path.join(__dirname, ".cache", "fixtures.json");

export type E2EFixtures = {
  password: string;
  admin: { email: string };
  customer: { email: string; name: string };
  seller: { email: string; shopName: string };
  product: { slug: string; title: string };
  provider: { email: string; name: string };
  service: { slug: string; title: string };
};

export const fixtures = (): E2EFixtures => JSON.parse(readFileSync(FIXTURES_FILE, "utf8"));

/** Answers the cookie banner whenever it gets in the way. */
export async function handleCookieBanner(page: Page) {
  const banner = page.getByRole("region", { name: "Cookie choices" });
  await page.addLocatorHandler(banner, async () => {
    await banner.getByRole("button", { name: "Reject non-essential" }).click();
  });
}

export async function signIn(page: Page, email: string, next = "/") {
  await handleCookieBanner(page);
  await page.goto(`/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByRole("textbox", { name: "Password" }).or(page.getByLabel("Password", { exact: true })).first().fill(fixtures().password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/"));
}

/** Fills a new delivery address in Ikeja, Lagos. */
export async function fillAddress(page: Page, name: string) {
  await page.getByLabel("Recipient's name").fill(name);
  await page.getByLabel("Phone number").fill("08031234567");
  await page.getByLabel("Street address").fill("12 Allen Avenue");
  await page.getByLabel("Town or city").fill("Ikeja");
  await page.getByLabel("State").selectOption({ label: "Lagos" });
  await expect(page.getByLabel("LGA").locator("option", { hasText: "Ikeja" })).toBeAttached();
  await page.getByLabel("LGA").selectOption({ label: "Ikeja" });
}

/** On the test payment page, approves the payment and waits for the order page. */
export async function payWithTestCard(page: Page) {
  await page.waitForURL(/\/checkout\/pay\/fake/);
  await page.getByRole("button", { name: "Pay (test card succeeds)" }).click();
  await page.waitForURL(/\/checkout\/complete\//);
}

/** Places the current cart's order with a new Ikeja address and pays; returns the order number and amount paid. */
export async function checkoutAndPay(page: Page, recipient: string, guestEmail?: string) {
  await page.goto("/checkout");
  if (guestEmail) await page.getByRole("textbox", { name: "Email" }).fill(guestEmail);
  if (await page.getByRole("radio", { name: /new address/i }).isVisible()) await page.getByRole("radio", { name: /new address/i }).check();
  await fillAddress(page, recipient);
  await page.getByRole("checkbox", { name: /terms/i }).check();
  const pay = page.getByRole("button", { name: /^Pay ₦/ });
  await expect(pay).toBeEnabled();
  const amount = (await pay.innerText()).replace(/^Pay\s*/, "").trim();
  await pay.click();
  await payWithTestCard(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Thank you! Your order is confirmed");
  await expect(page.getByText(`We've received your payment of ${amount}.`)).toBeVisible();
  const orderNumber = (await page.getByText(/^Order\s/).first().locator("span").first().innerText()).trim();
  return { orderNumber, amount };
}
