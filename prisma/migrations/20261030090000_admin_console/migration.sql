-- CreateEnum
CREATE TYPE "report_reason" AS ENUM ('prohibited', 'counterfeit', 'misleading', 'offensive', 'scam', 'other', 'keyword_match');

-- CreateEnum
CREATE TYPE "report_status" AS ENUM ('open', 'actioned', 'dismissed');

-- CreateEnum
CREATE TYPE "question_status" AS ENUM ('published', 'hidden');

-- CreateEnum
CREATE TYPE "ops_event_kind" AS ENUM ('backup', 'restore_test');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "taken_down_at" TIMESTAMPTZ(6),
ADD COLUMN     "taken_down_by" UUID,
ADD COLUMN     "taken_down_reason" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "taken_down_at" TIMESTAMPTZ(6),
ADD COLUMN     "taken_down_by" UUID,
ADD COLUMN     "taken_down_reason" TEXT;

-- CreateTable
CREATE TABLE "listing_reports" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID,
    "service_id" UUID,
    "business_id" UUID NOT NULL,
    "reporter_user_id" UUID,
    "reason" "report_reason" NOT NULL,
    "details" TEXT,
    "matched" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "report_status" NOT NULL DEFAULT 'open',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "resolution_note" TEXT,
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_questions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "product_id" UUID,
    "service_id" UUID,
    "business_id" UUID NOT NULL,
    "asker_user_id" UUID,
    "asker_name" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT,
    "answered_by" UUID,
    "answered_at" TIMESTAMPTZ(6),
    "status" "question_status" NOT NULL DEFAULT 'published',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "token_hash" TEXT NOT NULL,
    "invited_by" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "accepted_user_id" UUID,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_banners" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "image_key" TEXT,
    "link_url" TEXT,
    "cta_label" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_banners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_stores" (
    "business_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_stores_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "faq_entries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "section" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer_html" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faq_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cms_pages" (
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body_html" TEXT NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cms_pages_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "ops_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "kind" "ops_event_kind" NOT NULL,
    "succeeded" BOOLEAN NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "finished_at" TIMESTAMPTZ(6) NOT NULL,
    "size_bytes" BIGINT,
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_reports_status_created_at_idx" ON "listing_reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "listing_reports_product_id_idx" ON "listing_reports"("product_id");

-- CreateIndex
CREATE INDEX "listing_reports_service_id_idx" ON "listing_reports"("service_id");

-- CreateIndex
CREATE INDEX "listing_reports_business_id_idx" ON "listing_reports"("business_id");

-- CreateIndex
CREATE INDEX "listing_reports_reporter_user_id_idx" ON "listing_reports"("reporter_user_id");

-- CreateIndex
CREATE INDEX "listing_questions_product_id_created_at_idx" ON "listing_questions"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_questions_service_id_created_at_idx" ON "listing_questions"("service_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_questions_business_id_answered_at_idx" ON "listing_questions"("business_id", "answered_at");

-- CreateIndex
CREATE INDEX "listing_questions_asker_user_id_idx" ON "listing_questions"("asker_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "staff_invitations_business_id_created_at_idx" ON "staff_invitations"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "cms_banners_is_active_sort_order_idx" ON "cms_banners"("is_active", "sort_order");

-- CreateIndex
CREATE INDEX "faq_entries_section_sort_order_idx" ON "faq_entries"("section", "sort_order");

-- CreateIndex
CREATE INDEX "ops_events_kind_finished_at_idx" ON "ops_events"("kind", "finished_at");

-- AddForeignKey
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reports" ADD CONSTRAINT "listing_reports_reporter_user_id_fkey" FOREIGN KEY ("reporter_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_questions" ADD CONSTRAINT "listing_questions_asker_user_id_fkey" FOREIGN KEY ("asker_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "featured_stores" ADD CONSTRAINT "featured_stores_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Phase 7: conventions ─────────────────────────────────────────────────────
SELECT attach_updated_at_trigger('public.listing_reports'::regclass);
SELECT attach_updated_at_trigger('public.listing_questions'::regclass);
SELECT attach_updated_at_trigger('public.staff_invitations'::regclass);
SELECT attach_updated_at_trigger('public.cms_banners'::regclass);
SELECT attach_updated_at_trigger('public.faq_entries'::regclass);
SELECT attach_updated_at_trigger('public.cms_pages'::regclass);

ALTER TABLE listing_reports ADD CONSTRAINT listing_reports_target CHECK (num_nonnulls(product_id, service_id) = 1);
ALTER TABLE listing_questions ADD CONSTRAINT listing_questions_target CHECK (num_nonnulls(product_id, service_id) = 1);
ALTER TABLE listing_questions ADD CONSTRAINT listing_questions_length CHECK (char_length(question) BETWEEN 5 AND 500 AND (answer IS NULL OR char_length(answer) <= 2000));
ALTER TABLE cms_banners ADD CONSTRAINT cms_banners_window CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at);
ALTER TABLE ops_events ADD CONSTRAINT ops_events_times CHECK (finished_at >= started_at);

-- One open report per shopper per listing; one pending invitation per email per shop.
CREATE UNIQUE INDEX listing_reports_one_open ON listing_reports (COALESCE(product_id, service_id), reporter_user_id)
  WHERE status = 'open' AND reporter_user_id IS NOT NULL;
CREATE UNIQUE INDEX listing_reports_one_keyword_flag ON listing_reports (COALESCE(product_id, service_id))
  WHERE status = 'open' AND reason = 'keyword_match';
CREATE UNIQUE INDEX staff_invitations_one_pending ON staff_invitations (business_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- ── Taking listings down ─────────────────────────────────────────────────────
-- Only TownMart sets or clears a take-down; sellers keep editing their listing meanwhile.
CREATE OR REPLACE FUNCTION guard_listing_takedown() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged() AND (
       (TG_OP = 'INSERT' AND (NEW.taken_down_at IS NOT NULL OR NEW.taken_down_reason IS NOT NULL OR NEW.taken_down_by IS NOT NULL))
    OR (TG_OP = 'UPDATE' AND (NEW.taken_down_at IS DISTINCT FROM OLD.taken_down_at
                              OR NEW.taken_down_reason IS DISTINCT FROM OLD.taken_down_reason
                              OR NEW.taken_down_by IS DISTINCT FROM OLD.taken_down_by))) THEN
    RAISE EXCEPTION 'Only TownMart can take a listing down or restore it' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_products_takedown BEFORE INSERT OR UPDATE ON products FOR EACH ROW EXECUTE FUNCTION guard_listing_takedown();
CREATE TRIGGER trg_services_takedown BEFORE INSERT OR UPDATE ON services FOR EACH ROW EXECUTE FUNCTION guard_listing_takedown();

-- A taken-down listing is not public; its own shop and TownMart still see it.
DROP POLICY products_read ON products;
CREATE POLICY products_read ON products FOR SELECT USING (
  (status = 'active' AND deleted_at IS NULL AND taken_down_at IS NULL AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.status = 'approved'))
  OR business_id = app_current_business_id() OR app_is_privileged());
DROP POLICY services_read ON services;
CREATE POLICY services_read ON services FOR SELECT USING (
  (status = 'active' AND deleted_at IS NULL AND taken_down_at IS NULL AND EXISTS (SELECT 1 FROM businesses b WHERE b.id = business_id AND b.status = 'approved'))
  OR business_id = app_current_business_id() OR app_is_privileged());

-- ── Row-level security ───────────────────────────────────────────────────────
-- Reports: written by the reporter (or TownMart code for keyword flags); read by
-- the reporter and TownMart. The shop is told about outcomes, never who reported.
ALTER TABLE listing_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_reports_read ON listing_reports FOR SELECT USING (app_is_privileged() OR reporter_user_id = app_current_user_id());
CREATE POLICY listing_reports_insert ON listing_reports FOR INSERT WITH CHECK (
  app_is_privileged() OR (reporter_user_id = app_current_user_id() AND reason <> 'keyword_match' AND status = 'open'));
CREATE POLICY listing_reports_update ON listing_reports FOR UPDATE USING (app_is_privileged()) WITH CHECK (app_is_privileged());
CREATE POLICY listing_reports_delete ON listing_reports FOR DELETE USING (app_is_privileged());

-- Questions: public once answered (and the listing is visible); the asker sees
-- their own; the shop sees and answers its own; TownMart hides.
ALTER TABLE listing_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY listing_questions_read ON listing_questions FOR SELECT USING (
  app_is_privileged() OR business_id = app_current_business_id() OR asker_user_id = app_current_user_id()
  OR (status = 'published' AND answer IS NOT NULL AND (
        (product_id IS NOT NULL AND EXISTS (SELECT 1 FROM products p WHERE p.id = product_id))
     OR (service_id IS NOT NULL AND EXISTS (SELECT 1 FROM services s WHERE s.id = service_id)))));
CREATE POLICY listing_questions_insert ON listing_questions FOR INSERT WITH CHECK (
  app_is_privileged() OR (asker_user_id = app_current_user_id() AND answer IS NULL AND status = 'published'));
CREATE POLICY listing_questions_update ON listing_questions FOR UPDATE
  USING (app_is_privileged() OR business_id = app_current_business_id())
  WITH CHECK (app_is_privileged() OR business_id = app_current_business_id());
CREATE POLICY listing_questions_delete ON listing_questions FOR DELETE USING (app_is_privileged());
-- Shops may only write the answer; hiding is TownMart's.
REVOKE UPDATE ON listing_questions FROM townmart_app;
GRANT UPDATE (answer, answered_by, answered_at, status, updated_at) ON listing_questions TO townmart_app;
CREATE OR REPLACE FUNCTION guard_question_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged() AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Only TownMart can hide or restore a question' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_listing_questions_guard BEFORE UPDATE ON listing_questions FOR EACH ROW EXECUTE FUNCTION guard_question_update();

-- Invitations: the shop (owner context) and TownMart. Accepting runs as TownMart code
-- after checking the token and the signed-in email.
ALTER TABLE staff_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_invitations_tenant ON staff_invitations
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

-- Public content: readable by everyone (published and in its window), written by TownMart.
ALTER TABLE cms_banners ENABLE ROW LEVEL SECURITY;
CREATE POLICY cms_banners_read ON cms_banners FOR SELECT USING (
  app_is_privileged() OR (is_active AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())));
CREATE POLICY cms_banners_write ON cms_banners FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE faq_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY faq_entries_read ON faq_entries FOR SELECT USING (app_is_privileged() OR is_published);
CREATE POLICY faq_entries_write ON faq_entries FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['featured_stores', 'cms_pages'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (true)', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged())', t || '_write', t);
  END LOOP;
END $$;

-- Backups and restore drills: TownMart only, append-only.
ALTER TABLE ops_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ops_events_privileged ON ops_events USING (app_is_privileged()) WITH CHECK (app_is_privileged());
REVOKE UPDATE, DELETE, TRUNCATE ON ops_events FROM townmart_app;

-- ── Reference data the admin console now edits ─────────────────────────────
-- Categories, attributes and platform settings stay readable by everyone, and
-- only TownMart (admin or system scope) may change them.
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY categories_read ON categories FOR SELECT USING (true);
CREATE POLICY categories_write ON categories FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY attributes_read ON attributes FOR SELECT USING (true);
CREATE POLICY attributes_write ON attributes FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE category_attributes ENABLE ROW LEVEL SECURITY;
CREATE POLICY category_attributes_read ON category_attributes FOR SELECT USING (true);
CREATE POLICY category_attributes_write ON category_attributes FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY settings_read ON settings FOR SELECT USING (true);
CREATE POLICY settings_write ON settings FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());
