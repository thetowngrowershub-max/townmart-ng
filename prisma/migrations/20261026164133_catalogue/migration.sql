-- CreateEnum
CREATE TYPE "business_type" AS ENUM ('retailer', 'supermarket', 'vendor', 'merchant', 'producer', 'service_provider', 'artisan');

-- CreateEnum
CREATE TYPE "business_status" AS ENUM ('draft', 'pending', 'under_review', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "kyc_status" AS ENUM ('not_submitted', 'pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "category_kind" AS ENUM ('product', 'service');

-- CreateEnum
CREATE TYPE "listing_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "unit_of_measure" AS ENUM ('piece', 'kg', 'litre', 'crate', 'bag', 'pack');

-- CreateEnum
CREATE TYPE "attribute_type" AS ENUM ('text', 'number', 'select');

-- CreateEnum
CREATE TYPE "stock_movement_reason" AS ENUM ('sale', 'reservation', 'release', 'refund_restock', 'manual_adjustment', 'import');

-- CreateEnum
CREATE TYPE "pricing_model" AS ENUM ('fixed', 'from', 'hourly', 'packages');

-- CreateEnum
CREATE TYPE "location_mode" AS ENUM ('on_site', 'at_provider', 'both');

-- CreateEnum
CREATE TYPE "import_job_status" AS ENUM ('queued', 'processing', 'completed', 'failed');

-- AlterEnum
ALTER TYPE "otp_purpose" ADD VALUE 'verify_business_phone';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone_verified_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "businesses" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "owner_user_id" UUID NOT NULL,
    "type" "business_type" NOT NULL,
    "name" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description" TEXT,
    "logo_key" TEXT,
    "banner_key" TEXT,
    "cac_number" TEXT,
    "email" CITEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "phone_verified_at" TIMESTAMPTZ(6),
    "address_encrypted" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state_id" SMALLINT NOT NULL,
    "lga_id" SMALLINT NOT NULL,
    "status" "business_status" NOT NULL DEFAULT 'draft',
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "sells_products" BOOLEAN NOT NULL DEFAULT true,
    "sells_services" BOOLEAN NOT NULL DEFAULT false,
    "seller_agreement_version" TEXT,
    "seller_agreement_accepted_at" TIMESTAMPTZ(6),
    "dpa_version" TEXT,
    "dpa_accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_staff" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "invited_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_kyc" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "provider_reference_encrypted" TEXT,
    "verification_status" "kyc_status" NOT NULL DEFAULT 'not_submitted',
    "id_document_type" TEXT,
    "document_keys" TEXT[],
    "verified_at" TIMESTAMPTZ(6),
    "reviewed_by" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_kyc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payout_accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "bank_code" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "account_number_last4" CHAR(4) NOT NULL,
    "account_name" TEXT NOT NULL,
    "provider_subaccount_code" TEXT,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_policies" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "return_window_days" SMALLINT NOT NULL DEFAULT 7,
    "pickup_address_encrypted" TEXT,
    "delivery_options" JSONB NOT NULL DEFAULT '{"delivery": true, "pickup": false}',
    "accepts_pay_on_delivery" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" "category_kind" NOT NULL,
    "icon" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attributes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "attribute_type" NOT NULL DEFAULT 'text',
    "options" TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_attributes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "category_id" UUID NOT NULL,
    "attribute_id" UUID NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description_html" TEXT NOT NULL DEFAULT '',
    "brand" TEXT,
    "tags" TEXT[],
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "base_price_kobo" BIGINT NOT NULL,
    "compare_at_price_kobo" BIGINT,
    "cost_price_kobo" BIGINT,
    "unit" "unit_of_measure" NOT NULL DEFAULT 'piece',
    "min_order_qty" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "allow_fractional_qty" BOOLEAN NOT NULL DEFAULT false,
    "track_inventory" BOOLEAN NOT NULL DEFAULT true,
    "allow_backorder" BOOLEAN NOT NULL DEFAULT false,
    "weight_grams" INTEGER,
    "dimensions" JSONB,
    "is_perishable" BOOLEAN NOT NULL DEFAULT false,
    "shelf_life_note" TEXT,
    "status" "listing_status" NOT NULL DEFAULT 'draft',
    "meta_title" TEXT,
    "meta_description" TEXT,
    "search_vector" tsvector,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "variant_id" UUID,
    "storage_key" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_cover" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_options" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "values" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "option_values" JSONB NOT NULL DEFAULT '{}',
    "price_kobo" BIGINT NOT NULL,
    "compare_at_price_kobo" BIGINT,
    "stock_qty" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "low_stock_threshold" DECIMAL(12,3) NOT NULL DEFAULT 5,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "variant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "change_qty" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "reason" "stock_movement_reason" NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "note" TEXT,
    "actor_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "slug" CITEXT NOT NULL,
    "description_html" TEXT NOT NULL DEFAULT '',
    "pricing_model" "pricing_model" NOT NULL DEFAULT 'fixed',
    "base_price_kobo" BIGINT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "location_mode" "location_mode" NOT NULL DEFAULT 'on_site',
    "service_lga_ids" INTEGER[],
    "radius_km" INTEGER,
    "deposit_percent" SMALLINT NOT NULL DEFAULT 0,
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "status" "listing_status" NOT NULL DEFAULT 'draft',
    "meta_title" TEXT,
    "meta_description" TEXT,
    "search_vector" tsvector,
    "rating_avg" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_packages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_kobo" BIGINT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_images" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_availability" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,
    "slot_minutes" SMALLINT NOT NULL,
    "buffer_minutes" SMALLINT NOT NULL DEFAULT 0,
    "max_per_slot" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_blackouts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "service_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_blackouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'products_csv',
    "status" "import_job_status" NOT NULL DEFAULT 'queued',
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "succeeded_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB,
    "created_by" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- CreateIndex
CREATE INDEX "businesses_owner_user_id_idx" ON "businesses"("owner_user_id");

-- CreateIndex
CREATE INDEX "businesses_status_created_at_idx" ON "businesses"("status", "created_at");

-- CreateIndex
CREATE INDEX "businesses_state_id_idx" ON "businesses"("state_id");

-- CreateIndex
CREATE INDEX "businesses_lga_id_state_id_idx" ON "businesses"("lga_id", "state_id");

-- CreateIndex
CREATE INDEX "business_staff_user_id_idx" ON "business_staff"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_staff_business_id_user_id_key" ON "business_staff"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_kyc_business_id_key" ON "business_kyc"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "payout_accounts_business_id_key" ON "payout_accounts"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "store_policies_business_id_key" ON "store_policies"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_sort_order_idx" ON "categories"("parent_id", "sort_order");

-- CreateIndex
CREATE INDEX "categories_kind_is_active_idx" ON "categories"("kind", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "attributes_slug_key" ON "attributes"("slug");

-- CreateIndex
CREATE INDEX "category_attributes_attribute_id_idx" ON "category_attributes"("attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_attributes_category_id_attribute_id_key" ON "category_attributes"("category_id", "attribute_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_business_id_status_created_at_idx" ON "products"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_business_key" ON "products"("id", "business_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_business_id_sort_order_idx" ON "product_images"("product_id", "business_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- CreateIndex
CREATE INDEX "product_images_business_id_idx" ON "product_images"("business_id");

-- CreateIndex
CREATE INDEX "product_options_product_id_business_id_idx" ON "product_options"("product_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_options_product_id_name_key" ON "product_options"("product_id", "name");

-- CreateIndex
CREATE INDEX "product_variants_product_id_business_id_position_idx" ON "product_variants"("product_id", "business_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_business_id_sku_key" ON "product_variants"("business_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_business_key" ON "product_variants"("id", "business_id");

-- CreateIndex
CREATE INDEX "stock_movements_variant_id_business_id_created_at_idx" ON "stock_movements"("variant_id", "business_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_business_id_created_at_idx" ON "stock_movements"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_business_id_status_created_at_idx" ON "services"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "services_category_id_idx" ON "services"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_id_business_key" ON "services"("id", "business_id");

-- CreateIndex
CREATE INDEX "service_packages_service_id_business_id_position_idx" ON "service_packages"("service_id", "business_id", "position");

-- CreateIndex
CREATE INDEX "service_packages_business_id_idx" ON "service_packages"("business_id");

-- CreateIndex
CREATE INDEX "service_images_service_id_business_id_sort_order_idx" ON "service_images"("service_id", "business_id", "sort_order");

-- CreateIndex
CREATE INDEX "service_images_business_id_idx" ON "service_images"("business_id");

-- CreateIndex
CREATE INDEX "service_availability_service_id_business_id_weekday_idx" ON "service_availability"("service_id", "business_id", "weekday");

-- CreateIndex
CREATE INDEX "service_availability_business_id_idx" ON "service_availability"("business_id");

-- CreateIndex
CREATE INDEX "service_blackouts_service_id_business_id_starts_at_idx" ON "service_blackouts"("service_id", "business_id", "starts_at");

-- CreateIndex
CREATE INDEX "service_blackouts_business_id_idx" ON "service_blackouts"("business_id");

-- CreateIndex
CREATE INDEX "import_jobs_business_id_created_at_idx" ON "import_jobs"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_state_id_fkey" FOREIGN KEY ("state_id") REFERENCES "states"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_lga_in_state" FOREIGN KEY ("lga_id", "state_id") REFERENCES "lgas"("id", "state_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_staff" ADD CONSTRAINT "business_staff_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_staff" ADD CONSTRAINT "business_staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_kyc" ADD CONSTRAINT "business_kyc_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_policies" ADD CONSTRAINT "store_policies_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attribute_id_fkey" FOREIGN KEY ("attribute_id") REFERENCES "attributes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_options" ADD CONSTRAINT "product_options_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_business_id_fkey" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_business_id_fkey" FOREIGN KEY ("variant_id", "business_id") REFERENCES "product_variants"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_images" ADD CONSTRAINT "service_images_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_availability" ADD CONSTRAINT "service_availability_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_blackouts" ADD CONSTRAINT "service_blackouts_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Raw SQL that Prisma cannot express
-- ═════════════════════════════════════════════════════════════════════════════

-- ── updated_at triggers for every new table that has updated_at ─────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
      AND NOT EXISTS (
        SELECT 1 FROM pg_trigger tg
        WHERE tg.tgrelid = format('public.%I', c.table_name)::regclass AND tg.tgname = 'trg_set_updated_at')
  LOOP
    PERFORM attach_updated_at_trigger(format('public.%I', t)::regclass);
  END LOOP;
END $$;

-- ── Check constraints ────────────────────────────────────────────────────────
ALTER TABLE businesses ADD CONSTRAINT businesses_rating_range CHECK (rating_avg BETWEEN 0 AND 5 AND rating_count >= 0);
ALTER TABLE businesses ADD CONSTRAINT businesses_sells_something CHECK (sells_products OR sells_services);
ALTER TABLE businesses ADD CONSTRAINT businesses_slug_format CHECK (slug::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE businesses ADD CONSTRAINT businesses_rejection_has_reason
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL);
ALTER TABLE payout_accounts ADD CONSTRAINT payout_accounts_last4_digits CHECK (account_number_last4 ~ '^[0-9]{4}$');
ALTER TABLE store_policies ADD CONSTRAINT store_policies_return_window CHECK (return_window_days BETWEEN 0 AND 90);

ALTER TABLE products ADD CONSTRAINT products_prices_valid CHECK (
  base_price_kobo >= 0
  AND (compare_at_price_kobo IS NULL OR compare_at_price_kobo > base_price_kobo)
  AND (cost_price_kobo IS NULL OR cost_price_kobo >= 0));
ALTER TABLE products ADD CONSTRAINT products_min_order_positive CHECK (min_order_qty > 0);
ALTER TABLE products ADD CONSTRAINT products_weight_nonneg CHECK (weight_grams IS NULL OR weight_grams >= 0);
ALTER TABLE products ADD CONSTRAINT products_rating_range CHECK (rating_avg BETWEEN 0 AND 5 AND rating_count >= 0);
ALTER TABLE products ADD CONSTRAINT products_slug_format CHECK (slug::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE product_variants ADD CONSTRAINT product_variants_prices_valid CHECK (
  price_kobo >= 0 AND (compare_at_price_kobo IS NULL OR compare_at_price_kobo > price_kobo));
ALTER TABLE product_variants ADD CONSTRAINT product_variants_threshold_nonneg CHECK (low_stock_threshold >= 0);
ALTER TABLE product_images ADD CONSTRAINT product_images_alt_required CHECK (length(btrim(alt_text)) > 0);
ALTER TABLE product_images ADD CONSTRAINT product_images_dimensions CHECK (width > 0 AND height > 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_nonzero CHECK (change_qty <> 0);

ALTER TABLE services ADD CONSTRAINT services_price_nonneg CHECK (base_price_kobo >= 0);
ALTER TABLE services ADD CONSTRAINT services_duration_positive CHECK (duration_minutes > 0);
ALTER TABLE services ADD CONSTRAINT services_deposit_range CHECK (deposit_percent BETWEEN 0 AND 100);
ALTER TABLE services ADD CONSTRAINT services_radius_positive CHECK (radius_km IS NULL OR radius_km > 0);
ALTER TABLE services ADD CONSTRAINT services_rating_range CHECK (rating_avg BETWEEN 0 AND 5 AND rating_count >= 0);
ALTER TABLE services ADD CONSTRAINT services_slug_format CHECK (slug::text ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE service_packages ADD CONSTRAINT service_packages_valid CHECK (price_kobo >= 0 AND duration_minutes > 0);
ALTER TABLE service_images ADD CONSTRAINT service_images_alt_required CHECK (length(btrim(alt_text)) > 0);
ALTER TABLE service_availability ADD CONSTRAINT service_availability_valid CHECK (
  weekday BETWEEN 0 AND 6
  AND start_minute BETWEEN 0 AND 1439
  AND end_minute BETWEEN 1 AND 1440
  AND start_minute < end_minute
  AND slot_minutes > 0
  AND buffer_minutes >= 0
  AND max_per_slot > 0);
ALTER TABLE service_blackouts ADD CONSTRAINT service_blackouts_valid CHECK (ends_at > starts_at);
ALTER TABLE categories ADD CONSTRAINT categories_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id);

-- One cover image per product, one default variant per product.
CREATE UNIQUE INDEX product_images_one_cover ON product_images (product_id) WHERE is_cover;
CREATE UNIQUE INDEX product_variants_one_default ON product_variants (product_id) WHERE is_default;

-- ── Full-text search (tsvector + GIN) and fuzzy matching (pg_trgm) ──────────
-- Maintained by triggers rather than generated columns because the inputs
-- (tags arrays, HTML stripping) use functions Postgres doesn't mark immutable.
CREATE OR REPLACE FUNCTION html_to_text(html text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(regexp_replace(coalesce(html, ''), '<[^>]*>', ' ', 'g'), '&[a-z#0-9]+;', ' ', 'gi')
$$;

CREATE OR REPLACE FUNCTION products_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.brand, '') || ' ' || array_to_string(NEW.tags, ' ')), 'B') ||
    setweight(to_tsvector('english', left(html_to_text(NEW.description_html), 4000)), 'C');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_products_search_vector
  BEFORE INSERT OR UPDATE OF title, brand, tags, description_html ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector();

CREATE OR REPLACE FUNCTION services_search_vector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', left(html_to_text(NEW.description_html), 4000)), 'C');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_services_search_vector
  BEFORE INSERT OR UPDATE OF title, description_html ON services
  FOR EACH ROW EXECUTE FUNCTION services_search_vector();

CREATE INDEX products_search_vector_gin ON products USING gin (search_vector);
CREATE INDEX services_search_vector_gin ON services USING gin (search_vector);
CREATE INDEX products_title_trgm ON products USING gin (title gin_trgm_ops);
CREATE INDEX services_title_trgm ON services USING gin (title gin_trgm_ops);
CREATE INDEX businesses_name_trgm ON businesses USING gin (name gin_trgm_ops);

-- Partial indexes for what the storefront actually reads.
CREATE INDEX products_active_by_category ON products (category_id, created_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX services_active_by_category ON services (category_id, created_at DESC)
  WHERE status = 'active' AND deleted_at IS NULL;
CREATE INDEX businesses_approved ON businesses (state_id, lga_id) WHERE status = 'approved';

-- ── Guard rails on seller-controlled status fields ──────────────────────────
-- Sellers may only create drafts and submit (draft/rejected → pending).
-- Every other status change needs an admin/system RLS scope.
CREATE OR REPLACE FUNCTION guard_business_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_privileged() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
      RAISE EXCEPTION 'new businesses must start as draft' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status
        AND NOT (OLD.status IN ('draft', 'rejected') AND NEW.status = 'pending') THEN
    RAISE EXCEPTION 'business status % → % requires an admin', OLD.status, NEW.status
      USING ERRCODE = 'insufficient_privilege';
  ELSIF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
        OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
        OR NEW.rating_avg IS DISTINCT FROM OLD.rating_avg
        OR NEW.rating_count IS DISTINCT FROM OLD.rating_count THEN
    RAISE EXCEPTION 'review and rating fields are managed by TownMart' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_businesses_guard_status
  BEFORE INSERT OR UPDATE ON businesses
  FOR EACH ROW EXECUTE FUNCTION guard_business_status();

-- Sellers can submit KYC (pending) but only TownMart can verify or fail it.
CREATE OR REPLACE FUNCTION guard_kyc_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged()
     AND (NEW.verification_status IN ('verified', 'failed') OR NEW.verified_at IS NOT NULL OR NEW.reviewed_by IS NOT NULL)
     AND (TG_OP = 'INSERT'
          OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
          OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
          OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by) THEN
    RAISE EXCEPTION 'KYC verification is managed by TownMart' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_business_kyc_guard
  BEFORE INSERT OR UPDATE ON business_kyc
  FOR EACH ROW EXECUTE FUNCTION guard_kyc_status();

-- ── Row-level security: tenant isolation on business_id ─────────────────────
-- A listing is public when it is active, not deleted, and its business is approved.
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
CREATE POLICY businesses_read ON businesses FOR SELECT USING (
  status = 'approved' OR owner_user_id = app_current_user_id() OR id = app_current_business_id() OR app_is_privileged());
CREATE POLICY businesses_insert ON businesses FOR INSERT
  WITH CHECK (owner_user_id = app_current_user_id() OR app_is_privileged());
CREATE POLICY businesses_update ON businesses FOR UPDATE
  USING (owner_user_id = app_current_user_id() OR id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (owner_user_id = app_current_user_id() OR id = app_current_business_id() OR app_is_privileged());
CREATE POLICY businesses_delete ON businesses FOR DELETE USING (app_is_privileged());

ALTER TABLE business_staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_staff_read ON business_staff FOR SELECT
  USING (user_id = app_current_user_id() OR business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY business_staff_write ON business_staff FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

-- Private seller data: the business itself and TownMart only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['business_kyc', 'payout_accounts', 'import_jobs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (business_id = app_current_business_id() OR app_is_privileged())
         WITH CHECK (business_id = app_current_business_id() OR app_is_privileged())', t || '_tenant', t);
  END LOOP;
END $$;

-- Store policies are shown publicly on storefronts.
ALTER TABLE store_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY store_policies_read ON store_policies FOR SELECT USING (true);
CREATE POLICY store_policies_write ON store_policies FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

-- Listings.
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY products_read ON products FOR SELECT USING (
  (status = 'active' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.status = 'approved'))
  OR business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY products_write ON products FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY services_read ON services FOR SELECT USING (
  (status = 'active' AND deleted_at IS NULL AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.status = 'approved'))
  OR business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY services_write ON services FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

-- Children are readable when their parent is (the EXISTS runs under the parent's RLS),
-- and writable only by the owning business. Composite FKs keep business_id consistent.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('product_images', 'products', 'product_id'),
    ('product_options', 'products', 'product_id'),
    ('product_variants', 'products', 'product_id'),
    ('service_packages', 'services', 'service_id'),
    ('service_images', 'services', 'service_id'),
    ('service_availability', 'services', 'service_id'),
    ('service_blackouts', 'services', 'service_id')) AS v(child, parent, fk)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.child);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (
         business_id = app_current_business_id() OR app_is_privileged()
         OR EXISTS (SELECT 1 FROM %I p WHERE p.id = %I))',
      r.child || '_read', r.child, r.parent, r.fk);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL
         USING (business_id = app_current_business_id() OR app_is_privileged())
         WITH CHECK (business_id = app_current_business_id() OR app_is_privileged())',
      r.child || '_write', r.child);
  END LOOP;
END $$;

-- Stock movements: the business and TownMart only; append-only for the app.
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_read ON stock_movements FOR SELECT
  USING (business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY stock_movements_insert ON stock_movements FOR INSERT
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());
REVOKE UPDATE, DELETE, TRUNCATE ON stock_movements FROM townmart_app;
