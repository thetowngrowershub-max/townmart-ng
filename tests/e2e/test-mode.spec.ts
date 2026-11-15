import { expect, test } from "@playwright/test";
import { handleCookieBanner } from "./fixtures";

// Only on a test-mode site (TOWNMART_TEST_MODE=true), like the Vercel staging site.
test.skip(process.env.TOWNMART_TEST_MODE !== "true", "needs a test-mode site");

test("a tester signs in as a demo seller without a password", async ({ page }) => {
  await handleCookieBanner(page);
  await page.goto("/");
  await expect(page.getByRole("note", { name: "Test site" })).toContainText("no real money moves");
  await page.getByRole("link", { name: "Demo accounts" }).click();
  await page.getByRole("button", { name: "Sign in as CV Gadget Hub" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test("a new account is confirmed from the test inbox", async ({ page }) => {
  await handleCookieBanner(page);
  const email = `tester-${Date.now()}@example.com`;
  await page.goto("/auth/sign-up");
  await page.getByLabel("Full name").fill("Test Tester");
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password").fill("a-long-test-password");
  await page.getByLabel(/I agree to the/).check();
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/sign-up"));

  // The confirmation email is written just after the response, so allow a moment.
  await expect(async () => {
    await page.goto(`/test-inbox?to=${encodeURIComponent(email)}`);
    await expect(page.getByRole("listitem").first()).toContainText(email, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByRole("listitem").first().getByRole("link").first().click();
  await page.getByRole("button", { name: "Confirm my email" }).click();
  await expect(page.getByText("Your email address is confirmed.")).toBeVisible();
});
