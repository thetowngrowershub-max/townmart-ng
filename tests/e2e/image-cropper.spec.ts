import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { fixtures, signIn } from "./fixtures";

test("a seller crops a product photo to a square before it uploads", async ({ page }) => {
  const f = fixtures();
  // A 1200 × 800 landscape photo: green on the left, orange on the right.
  const photo = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#0f6b3e" } })
    .composite([{ input: { create: { width: 600, height: 800, channels: 3, background: "#f08a24" } }, left: 600, top: 0 }])
    .png()
    .toBuffer();

  await signIn(page, f.seller.email, "/dashboard/products/new");
  await page.locator('input[type="file"][accept^="image/"]').first().setInputFiles({ name: "red-phone-case.png", mimeType: "image/png", buffer: photo });

  const dialog = page.getByRole("dialog", { name: /Crop image/ });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Square/ })).toBeChecked();
  // Zoom in, then move the photo with the keyboard.
  await dialog.getByRole("button", { name: "Zoom in" }).click();
  await dialog.getByRole("group", { name: /Crop area/ }).press("ArrowLeft");
  await dialog.getByRole("button", { name: "Crop and add" }).click();
  await expect(dialog).toBeHidden();

  // The uploaded image is square, and keeps a name from the file for its alt text.
  const preview = page.locator("ol img").first();
  await expect(preview).toBeVisible();
  const { w, h } = await preview.evaluate((img: HTMLImageElement) => ({ w: img.naturalWidth, h: img.naturalHeight }));
  expect(w).toBeGreaterThan(100);
  expect(w).toBe(h);
  await expect(page.getByLabel("Alt text (describe the image)")).toHaveValue("red phone case");

  // It can be cropped again, here to 4:3.
  await page.getByRole("button", { name: "Crop image 1" }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByText("4:3").click();
  await dialog.getByRole("button", { name: "Crop and add" }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? Math.round((img.naturalWidth / img.naturalHeight) * 100) : 0)))
    .toBe(133);
});
