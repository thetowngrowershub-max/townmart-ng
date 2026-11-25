-- CreateTable
CREATE TABLE "portfolio_photos" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "storage_key" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portfolio_photos_business_id_sort_order_idx" ON "portfolio_photos"("business_id", "sort_order");

-- AddForeignKey
ALTER TABLE "portfolio_photos" ADD CONSTRAINT "portfolio_photos_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

SELECT attach_updated_at_trigger('public.portfolio_photos'::regclass);

-- ── Rules the app relies on ──────────────────────────────────────────────────
ALTER TABLE portfolio_photos ADD CONSTRAINT portfolio_photos_caption_required CHECK (length(btrim(caption)) BETWEEN 3 AND 160);
ALTER TABLE portfolio_photos ADD CONSTRAINT portfolio_photos_dimensions CHECK (width > 0 AND height > 0);
-- A photo must be one this business uploaded (keys are namespaced by business).
ALTER TABLE portfolio_photos ADD CONSTRAINT portfolio_photos_own_key CHECK (storage_key LIKE 'portfolios/' || business_id::text || '/%');

-- ── Row-level security ───────────────────────────────────────────────────────
-- Public when the business is visible (the EXISTS runs under the businesses
-- policy, so only approved shops); written only by the shop and TownMart.
ALTER TABLE portfolio_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY portfolio_photos_read ON portfolio_photos FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id));
CREATE POLICY portfolio_photos_write ON portfolio_photos FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());
