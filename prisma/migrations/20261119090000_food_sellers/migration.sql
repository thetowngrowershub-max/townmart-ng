-- Restaurants (QSRs) and confectioners: new business types, food categories,
-- prep times on menu items, and opening hours for stores.

-- AlterEnum
ALTER TYPE "business_type" ADD VALUE 'restaurant';
ALTER TYPE "business_type" ADD VALUE 'confectioner';

-- AlterTable
ALTER TABLE "categories" ADD COLUMN "is_food" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "products" ADD COLUMN "prep_time_minutes" SMALLINT;
ALTER TABLE products ADD CONSTRAINT products_prep_time CHECK (prep_time_minutes IS NULL OR prep_time_minutes BETWEEN 1 AND 1440);

-- AlterTable
ALTER TABLE "store_policies" ADD COLUMN "opening_hours" JSONB,
ADD COLUMN "orders_paused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE store_policies ADD CONSTRAINT store_policies_opening_hours_week
  CHECK (opening_hours IS NULL OR (jsonb_typeof(opening_hours) = 'array' AND jsonb_array_length(opening_hours) = 7));
