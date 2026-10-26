-- CreateEnum
CREATE TYPE "discount_type" AS ENUM ('percentage', 'fixed');

-- CreateEnum
CREATE TYPE "promotion_scope" AS ENUM ('product', 'products', 'category', 'store', 'service');

-- CreateTable
CREATE TABLE "promotions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discount_type" "discount_type" NOT NULL,
    "discount_value" BIGINT NOT NULL,
    "scope" "promotion_scope" NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "min_order_kobo" BIGINT NOT NULL DEFAULT 0,
    "is_flash_deal" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "has_coupon" BOOLEAN NOT NULL DEFAULT false,
    "redemption_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_targets" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "promotion_id" UUID NOT NULL,
    "business_id" UUID,
    "product_id" UUID,
    "service_id" UUID,
    "category_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "promotion_id" UUID NOT NULL,
    "business_id" UUID,
    "code" CITEXT NOT NULL,
    "allows_stacking" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotion_redemptions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "promotion_id" UUID NOT NULL,
    "coupon_id" UUID,
    "business_id" UUID,
    "order_id" UUID NOT NULL,
    "user_id" UUID,
    "discount_kobo" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotion_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "promotions_business_id_ends_at_idx" ON "promotions"("business_id", "ends_at");

-- CreateIndex
CREATE INDEX "promotions_live_idx" ON "promotions"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "promotion_targets_promotion_id_idx" ON "promotion_targets"("promotion_id");

-- CreateIndex
CREATE INDEX "promotion_targets_product_id_business_id_idx" ON "promotion_targets"("product_id", "business_id");

-- CreateIndex
CREATE INDEX "promotion_targets_service_id_business_id_idx" ON "promotion_targets"("service_id", "business_id");

-- CreateIndex
CREATE INDEX "promotion_targets_category_id_idx" ON "promotion_targets"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_promotion_id_key" ON "coupons"("promotion_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_business_id_idx" ON "coupons"("business_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_coupon_id_idx" ON "promotion_redemptions"("coupon_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_user_id_promotion_id_idx" ON "promotion_redemptions"("user_id", "promotion_id");

-- CreateIndex
CREATE INDEX "promotion_redemptions_business_id_created_at_idx" ON "promotion_redemptions"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "promotion_redemptions_promotion_id_order_id_key" ON "promotion_redemptions"("promotion_id", "order_id");

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_product_same_business" FOREIGN KEY ("product_id", "business_id") REFERENCES "products"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_service_same_business" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_targets" ADD CONSTRAINT "promotion_targets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_promotion_id_fkey" FOREIGN KEY ("promotion_id") REFERENCES "promotions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Raw SQL that Prisma cannot express
-- ═════════════════════════════════════════════════════════════════════════════

-- ── updated_at triggers ──────────────────────────────────────────────────────
SELECT attach_updated_at_trigger('public.promotions'::regclass);
SELECT attach_updated_at_trigger('public.coupons'::regclass);

-- ── Check constraints ────────────────────────────────────────────────────────
ALTER TABLE promotions ADD CONSTRAINT promotions_window CHECK (ends_at > starts_at);
ALTER TABLE promotions ADD CONSTRAINT promotions_discount_value CHECK (
  discount_value > 0 AND (discount_type <> 'percentage' OR discount_value <= 100));
ALTER TABLE promotions ADD CONSTRAINT promotions_limits CHECK (
  (usage_limit IS NULL OR usage_limit > 0) AND (per_customer_limit IS NULL OR per_customer_limit > 0)
  AND min_order_kobo >= 0 AND redemption_count >= 0);
ALTER TABLE promotions ADD CONSTRAINT promotions_name_length CHECK (char_length(name) BETWEEN 2 AND 80);
ALTER TABLE promotion_targets ADD CONSTRAINT promotion_targets_exactly_one CHECK (num_nonnulls(product_id, service_id, category_id) = 1);
ALTER TABLE coupons ADD CONSTRAINT coupons_code_format CHECK (code::text ~ '^[A-Za-z0-9-]{4,24}$');
ALTER TABLE promotion_redemptions ADD CONSTRAINT promotion_redemptions_discount CHECK (discount_kobo >= 0);

CREATE UNIQUE INDEX promotion_targets_unique ON promotion_targets (promotion_id, coalesce(product_id, service_id, category_id));
-- The storefront looks up live promotions on every listing page.
CREATE INDEX promotions_active ON promotions (ends_at, business_id) WHERE is_active;

-- ── Children inherit the promotion's business ───────────────────────────────
-- Targets and coupons copy business_id from their promotion, so a seller can't
-- attach one to another seller's promotion (the promotion isn't visible to them,
-- business_id stays NULL and the RLS check rejects the row).
CREATE OR REPLACE FUNCTION promotion_child_business() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.business_id := (SELECT business_id FROM promotions WHERE id = NEW.promotion_id);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_promotion_targets_business BEFORE INSERT OR UPDATE ON promotion_targets
  FOR EACH ROW EXECUTE FUNCTION promotion_child_business();
CREATE TRIGGER trg_coupons_business BEFORE INSERT OR UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION promotion_child_business();

-- ── Counters maintained by triggers, never by sellers ───────────────────────
CREATE OR REPLACE FUNCTION coupons_sync_has_coupon() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    UPDATE promotions SET has_coupon = EXISTS (SELECT 1 FROM coupons c WHERE c.promotion_id = OLD.promotion_id) WHERE id = OLD.promotion_id;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    UPDATE promotions SET has_coupon = true WHERE id = NEW.promotion_id;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_coupons_has_coupon AFTER INSERT OR UPDATE OR DELETE ON coupons
  FOR EACH ROW EXECUTE FUNCTION coupons_sync_has_coupon();

CREATE OR REPLACE FUNCTION promotion_redemptions_count() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE promotions SET redemption_count = redemption_count + 1 WHERE id = NEW.promotion_id;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_promotion_redemptions_count AFTER INSERT ON promotion_redemptions
  FOR EACH ROW EXECUTE FUNCTION promotion_redemptions_count();

-- Direct statements from the app can't set the derived columns; the triggers above can.
CREATE OR REPLACE FUNCTION guard_promotion_counters() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_privileged() OR pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.has_coupon OR NEW.redemption_count <> 0 THEN
      RAISE EXCEPTION 'has_coupon and redemption_count are maintained by TownMart' USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NEW.has_coupon IS DISTINCT FROM OLD.has_coupon OR NEW.redemption_count IS DISTINCT FROM OLD.redemption_count THEN
    RAISE EXCEPTION 'has_coupon and redemption_count are maintained by TownMart' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_promotions_guard_counters BEFORE INSERT OR UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION guard_promotion_counters();

-- ── Row-level security ───────────────────────────────────────────────────────
-- Promotions of approved stores (and platform-wide ones) are public while active,
-- so listings can show their discounts. Coupon codes are never public.
ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotions_read ON promotions FOR SELECT USING (
  (is_active AND ends_at > now()
    AND (business_id IS NULL OR EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.status = 'approved')))
  OR business_id = app_current_business_id() OR app_is_privileged());
-- Platform-wide promotions (business_id NULL) never match app_current_business_id(): admin/system only.
CREATE POLICY promotions_write ON promotions FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

ALTER TABLE promotion_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotion_targets_read ON promotion_targets FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_id));
CREATE POLICY promotion_targets_write ON promotion_targets FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY coupons_tenant ON coupons
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

-- Redemptions are written by checkout in the system scope and never edited.
ALTER TABLE promotion_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY promotion_redemptions_read ON promotion_redemptions FOR SELECT USING (
  business_id = app_current_business_id() OR user_id = app_current_user_id() OR app_is_privileged());
CREATE POLICY promotion_redemptions_insert ON promotion_redemptions FOR INSERT WITH CHECK (app_is_privileged());
REVOKE UPDATE, DELETE, TRUNCATE ON promotion_redemptions FROM townmart_app;
