import { expect, test } from "@playwright/test";
import { checkoutAndPay, fixtures, handleCookieBanner } from "./fixtures";

test("a guest buys a product and pays online", async ({ page }) => {
  const f = fixtures();
  await handleCookieBanner(page);
  await page.goto(`/p/${f.product.slug}`);
  await expect(page.getByRole("heading", { level: 1, name: f.product.title })).toBeVisible();
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "View cart" }).click();
  await expect(page.getByRole("link", { name: f.product.title }).last()).toBeVisible();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.waitForURL(/\/checkout$/);

  const { orderNumber, amount } = await checkoutAndPay(page, "Tunde Bakare", `guest-${Date.now()}@test.townmart.local`);
  expect(orderNumber).toMatch(/^TM-\d{4}-\d+$/);
  expect(amount).toMatch(/^₦[\d,]+(\.\d\d)?$/);
});
