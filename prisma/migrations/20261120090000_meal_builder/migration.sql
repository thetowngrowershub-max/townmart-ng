-- Meal builder for restaurants: the plate's options on the product, and the
-- customer's choices on the cart line (one line per variant and plate).

-- AlterTable
ALTER TABLE "products" ADD COLUMN "meal_builder" JSONB;

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN "choices" JSONB,
ADD COLUMN "choices_key" TEXT NOT NULL DEFAULT '';

-- DropIndex
DROP INDEX "cart_items_cart_id_variant_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_choices_key_key" ON "cart_items"("cart_id", "variant_id", "choices_key");
