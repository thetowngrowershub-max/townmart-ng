import { expect, test } from "@playwright/test";
import { checkoutAndPay, fixtures, signIn } from "./fixtures";

test("a customer asks for a refund after delivery and the seller approves it", async ({ browser }) => {
  const f = fixtures();
  const customer = await (await browser.newContext()).newPage();
  const seller = await (await browser.newContext()).newPage();

  // The customer buys two screen protectors.
  await signIn(customer, f.customer.email, `/p/${f.product.slug}`);
  await customer.getByRole("button", { name: "Increase quantity" }).click();
  await customer.getByRole("button", { name: "Add to cart" }).click();
  await expect(customer.getByText("View cart")).toBeVisible();
  const { orderNumber } = await checkoutAndPay(customer, f.customer.name);

  // The seller prepares, sends and delivers it.
  await signIn(seller, f.seller.email, "/dashboard/orders");
  await seller.getByRole("link", { name: orderNumber }).first().click();
  await seller.getByRole("button", { name: "Start preparing" }).click();
  await seller.getByRole("button", { name: "Mark as sent" }).click();
  await seller.getByRole("button", { name: "Mark as delivered" }).click();
  await expect(seller.getByRole("button", { name: "Mark as delivered" })).toBeHidden();

  // The customer asks for one of the two back.
  await customer.goto(`/account/orders/${orderNumber}`);
  await customer.getByRole("link", { name: "Cancel, return or get help" }).click();
  await customer.getByRole("combobox", { name: /How many/ }).selectOption("1");
  await customer.getByLabel("What went wrong?").selectOption({ label: "Changed my mind" });
  await customer.getByLabel("Tell the seller more").fill("I only needed one. The second is unopened.");
  await customer.getByRole("button", { name: "Send to the seller" }).click();
  await expect(customer.getByText("Waiting for the seller", { exact: true })).toBeVisible();

  // The seller approves; the money goes back straight away.
  await seller.goto("/dashboard/refunds");
  await seller.getByRole("row").filter({ hasText: `Order ${orderNumber}` }).getByRole("link").click();
  await seller.getByRole("tab", { name: "Approve" }).click();
  await seller.getByRole("button", { name: "Approve refund" }).click();
  await expect(seller.getByText(/^Paid back .*Banks can take a few working days/)).toBeVisible();

  await customer.goto(`/account/orders/${orderNumber}`);
  await expect(customer.getByText("₦2,500 refunded.")).toBeVisible();
  await expect(customer.getByText(/^Partly refunded/)).toBeVisible();
});
