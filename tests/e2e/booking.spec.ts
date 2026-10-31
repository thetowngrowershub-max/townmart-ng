import { expect, test } from "@playwright/test";
import { checkoutAndPay, fixtures, signIn } from "./fixtures";

test("a customer books and pays for a service and the provider confirms it", async ({ browser }) => {
  const f = fixtures();
  const customer = await (await browser.newContext()).newPage();
  const provider = await (await browser.newContext()).newPage();

  // The customer picks the first free time and pays.
  await signIn(customer, f.customer.email, `/s/${f.service.slug}`);
  await expect(customer.getByRole("heading", { level: 1, name: f.service.title })).toBeVisible();
  const day = customer.getByRole("radio").and(customer.locator("button:not([disabled])")).first();
  await day.click();
  const time = customer.getByRole("radiogroup").nth(1).getByRole("radio").first();
  const slot = (await time.innerText()).split("\n")[0]!.trim();
  await time.click();
  await customer.getByRole("button", { name: "Book now" }).click();
  await expect(customer.getByText(/added to your cart/)).toBeVisible();
  const { orderNumber } = await checkoutAndPay(customer, f.customer.name);

  await customer.goto("/account/bookings");
  const booking = customer.getByRole("listitem").filter({ hasText: `Order ${orderNumber}` });
  await expect(booking).toContainText(f.service.title);
  await expect(booking).toContainText(slot);
  await expect(booking).toContainText("Waiting for the provider");

  // The provider confirms it.
  await signIn(provider, f.provider.email, "/dashboard/bookings");
  const row = provider.locator("li, tr").filter({ hasText: orderNumber }).first();
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(row.getByRole("button", { name: "Confirm" })).toBeHidden();

  await customer.reload();
  await expect(booking).toContainText("Confirmed");
});
