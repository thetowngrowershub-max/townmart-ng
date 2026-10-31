import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fixtures, handleCookieBanner, signIn } from "./fixtures";

/** WCAG 2.2 A and AA rules, on the pages people use most. */
async function audit(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const summary = violations.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 5).map((n) => `    ${n.target.join(" ")}`).join("\n")}`);
  expect(summary, `${path} has accessibility problems`).toEqual([]);
}

test.describe("accessibility", () => {
  test("public pages", async ({ page }) => {
    const f = fixtures();
    // Check the cookie banner itself first, then answer it.
    await audit(page, "/");
    await handleCookieBanner(page);
    for (const path of ["/", "/search?q=phone", `/p/${f.product.slug}`, `/s/${f.service.slug}`, "/store/cv-gadget-hub", "/deals", "/cart", "/auth/sign-in", "/auth/sign-up", "/sell", "/help", "/legal/terms"]) {
      await audit(page, path);
    }
  });

  test("checkout and account", async ({ page }) => {
    const f = fixtures();
    await signIn(page, f.customer.email, `/p/${f.product.slug}`);
    await page.getByRole("button", { name: "Add to cart" }).click();
    await expect(page.getByText("View cart")).toBeVisible();
    for (const path of ["/checkout", "/account", "/account/orders", "/account/bookings", "/account/refunds", "/account/security"]) {
      await audit(page, path);
    }
    // Leave the cart empty for the other tests.
    await page.goto("/cart");
    await page.getByRole("button", { name: "Remove" }).first().click();
  });

  test("seller dashboard", async ({ page }) => {
    const f = fixtures();
    await signIn(page, f.seller.email, "/dashboard");
    for (const path of ["/dashboard", "/dashboard/orders", "/dashboard/products", "/dashboard/refunds"]) {
      await audit(page, path);
    }
  });

  test("admin", async ({ page }) => {
    await signIn(page, fixtures().admin.email, "/admin");
    for (const path of ["/admin", "/admin/orders", "/admin/sellers", "/admin/refunds", "/admin/system"]) {
      await audit(page, path);
    }
  });
});
