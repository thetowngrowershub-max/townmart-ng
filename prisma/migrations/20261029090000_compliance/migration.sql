-- CreateEnum
CREATE TYPE "acceptance_context" AS ENUM ('sign_up', 'checkout', 'seller_onboarding');

-- CreateEnum
CREATE TYPE "dsr_type" AS ENUM ('access', 'portability', 'rectification', 'erasure', 'restriction', 'objection', 'withdraw_consent', 'other');

-- CreateEnum
CREATE TYPE "dsr_status" AS ENUM ('unverified', 'open', 'in_progress', 'completed', 'rejected', 'cancelled');

-- CreateEnum
CREATE TYPE "risk_level" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "breach_status" AS ENUM ('open', 'contained', 'closed');

-- CreateEnum
CREATE TYPE "subject_notice_status" AS ENUM ('not_required', 'pending', 'sent');

-- CreateEnum
CREATE TYPE "lawful_basis" AS ENUM ('consent', 'contract', 'legal_obligation', 'vital_interests', 'public_interest', 'legitimate_interests');

-- CreateEnum
CREATE TYPE "dpia_status" AS ENUM ('draft', 'approved', 'needs_review');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "anonymised_at" TIMESTAMPTZ(6),
ADD COLUMN     "two_factor_enabled_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "legal_documents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "slug" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "body_html" TEXT NOT NULL,
    "effective_at" TIMESTAMPTZ(6) NOT NULL,
    "is_template" BOOLEAN NOT NULL DEFAULT true,
    "change_note" TEXT,
    "published_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_acceptances" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "document_id" UUID NOT NULL,
    "context" "acceptance_context" NOT NULL,
    "user_id" UUID,
    "order_id" UUID,
    "business_id" UUID,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "accepted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_acceptances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "subject_id" UUID NOT NULL,
    "user_id" UUID,
    "functional" BOOLEAN NOT NULL,
    "analytics" BOOLEAN NOT NULL,
    "marketing" BOOLEAN NOT NULL,
    "policy_version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "sms_order_updates" BOOLEAN NOT NULL DEFAULT true,
    "sms_booking_reminders" BOOLEAN NOT NULL DEFAULT true,
    "email_messages" BOOLEAN NOT NULL DEFAULT true,
    "marketing_email" BOOLEAN NOT NULL DEFAULT false,
    "marketing_email_at" TIMESTAMPTZ(6),
    "marketing_sms" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "marketing_suppressions" (
    "email" CITEXT NOT NULL,
    "source" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_suppressions_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reference" TEXT NOT NULL,
    "type" "dsr_type" NOT NULL,
    "status" "dsr_status" NOT NULL DEFAULT 'open',
    "user_id" UUID,
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "details" TEXT,
    "channel" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "due_at" TIMESTAMPTZ(6),
    "assigned_to" UUID,
    "resolution_note" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "export_json_key" TEXT,
    "export_pdf_key" TEXT,
    "export_expires_at" TIMESTAMPTZ(6),
    "ip_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breach_incidents" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "detected_at" TIMESTAMPTZ(6) NOT NULL,
    "aware_at" TIMESTAMPTZ(6) NOT NULL,
    "data_categories" TEXT[],
    "subjects_affected" INTEGER,
    "risk" "risk_level" NOT NULL,
    "actions" TEXT,
    "status" "breach_status" NOT NULL DEFAULT 'open',
    "ndpc_notified_at" TIMESTAMPTZ(6),
    "ndpc_reference" TEXT,
    "subject_notice" "subject_notice_status" NOT NULL DEFAULT 'pending',
    "subjects_notified_at" TIMESTAMPTZ(6),
    "created_by" UUID NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "breach_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_activities" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "lawful_basis" "lawful_basis" NOT NULL,
    "data_subjects" TEXT[],
    "data_categories" TEXT[],
    "recipients" TEXT[],
    "transfers" TEXT,
    "retention" TEXT NOT NULL,
    "security" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_processors" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "data_categories" TEXT[],
    "location" TEXT NOT NULL,
    "safeguards" TEXT,
    "dpa_signed_at" TIMESTAMPTZ(6),
    "website" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_processors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dpia_records" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "title" TEXT NOT NULL,
    "activity_id" UUID,
    "description" TEXT NOT NULL,
    "risks" TEXT NOT NULL,
    "mitigations" TEXT NOT NULL,
    "residual_risk" "risk_level" NOT NULL,
    "status" "dpia_status" NOT NULL DEFAULT 'draft',
    "reviewed_at" TIMESTAMPTZ(6),
    "next_review_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dpia_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_settings" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retention_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "legal_documents_slug_effective_at_idx" ON "legal_documents"("slug", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "legal_documents_slug_version_key" ON "legal_documents"("slug", "version");

-- CreateIndex
CREATE INDEX "policy_acceptances_user_id_accepted_at_idx" ON "policy_acceptances"("user_id", "accepted_at");

-- CreateIndex
CREATE INDEX "policy_acceptances_order_id_idx" ON "policy_acceptances"("order_id");

-- CreateIndex
CREATE INDEX "policy_acceptances_business_id_idx" ON "policy_acceptances"("business_id");

-- CreateIndex
CREATE INDEX "policy_acceptances_document_id_idx" ON "policy_acceptances"("document_id");

-- CreateIndex
CREATE INDEX "consent_records_subject_id_created_at_idx" ON "consent_records"("subject_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_user_id_created_at_idx" ON "consent_records"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_created_at_idx" ON "consent_records"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_subject_requests_reference_key" ON "data_subject_requests"("reference");

-- CreateIndex
CREATE INDEX "data_subject_requests_status_due_at_idx" ON "data_subject_requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_user_id_created_at_idx" ON "data_subject_requests"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "data_subject_requests_email_idx" ON "data_subject_requests"("email");

-- CreateIndex
CREATE UNIQUE INDEX "breach_incidents_reference_key" ON "breach_incidents"("reference");

-- CreateIndex
CREATE INDEX "breach_incidents_status_aware_at_idx" ON "breach_incidents"("status", "aware_at");

-- CreateIndex
CREATE UNIQUE INDEX "data_processors_name_key" ON "data_processors"("name");

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "legal_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dpia_records" ADD CONSTRAINT "dpia_records_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "processing_activities"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CreateIndex
CREATE INDEX "dpia_records_activity_id_idx" ON "dpia_records"("activity_id");

-- CreateIndex
CREATE INDEX "carts_updated_at_idx" ON "carts"("updated_at");

-- CreateIndex
CREATE INDEX "job_runs_started_at_idx" ON "job_runs"("started_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

SELECT attach_updated_at_trigger('public.legal_documents'::regclass);
SELECT attach_updated_at_trigger('public.notification_preferences'::regclass);
SELECT attach_updated_at_trigger('public.data_subject_requests'::regclass);
SELECT attach_updated_at_trigger('public.breach_incidents'::regclass);
SELECT attach_updated_at_trigger('public.processing_activities'::regclass);
SELECT attach_updated_at_trigger('public.data_processors'::regclass);
SELECT attach_updated_at_trigger('public.dpia_records'::regclass);
SELECT attach_updated_at_trigger('public.retention_settings'::regclass);

-- ── Reference numbers: DSR-2026-000123, BR-2026-0001 ─────────────────────────
CREATE SEQUENCE dsr_number_seq;
CREATE OR REPLACE FUNCTION next_dsr_reference() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'DSR-' || to_char(now() AT TIME ZONE 'Africa/Lagos', 'YYYY') || '-' || lpad(nextval('dsr_number_seq')::text, 6, '0')
$$;
CREATE SEQUENCE breach_number_seq;
CREATE OR REPLACE FUNCTION next_breach_reference() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'BR-' || to_char(now() AT TIME ZONE 'Africa/Lagos', 'YYYY') || '-' || lpad(nextval('breach_number_seq')::text, 4, '0')
$$;

-- ── Check constraints ────────────────────────────────────────────────────────
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE legal_documents ADD CONSTRAINT legal_documents_text CHECK (char_length(title) BETWEEN 1 AND 120 AND char_length(body_html) BETWEEN 1 AND 200000);
-- An acceptance belongs to someone: a user, an order (guests) or a business.
ALTER TABLE policy_acceptances ADD CONSTRAINT policy_acceptances_owner CHECK (num_nonnulls(user_id, order_id, business_id) > 0);
ALTER TABLE consent_records ADD CONSTRAINT consent_records_source CHECK (source IN ('banner', 'settings', 'privacy_centre'));
ALTER TABLE data_subject_requests ADD CONSTRAINT dsr_channel CHECK (channel IN ('privacy_centre', 'public_form'));
ALTER TABLE data_subject_requests ADD CONSTRAINT dsr_details CHECK (details IS NULL OR char_length(details) <= 4000);
ALTER TABLE data_subject_requests ADD CONSTRAINT dsr_due CHECK (status = 'unverified' OR due_at IS NOT NULL);
ALTER TABLE breach_incidents ADD CONSTRAINT breach_times CHECK (aware_at >= detected_at - interval '1 day' AND (subjects_affected IS NULL OR subjects_affected >= 0));
ALTER TABLE retention_settings ADD CONSTRAINT retention_days CHECK (days BETWEEN 1 AND 3650);

-- One erasure request in progress per account (the 14-day grace window).
CREATE UNIQUE INDEX dsr_one_open_erasure ON data_subject_requests (user_id) WHERE type = 'erasure' AND status IN ('open', 'in_progress');

-- ── Append-only evidence ─────────────────────────────────────────────────────
-- Acceptances and consent choices are proof; the app can only add to them.
-- (Foreign-key cascades still remove them with a purged unverified account.)
REVOKE UPDATE, DELETE, TRUNCATE ON policy_acceptances, consent_records FROM townmart_app;

-- ── Row-level security ───────────────────────────────────────────────────────
-- Legal texts are public; only TownMart publishes them.
ALTER TABLE legal_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_documents_read ON legal_documents FOR SELECT USING (true);
CREATE POLICY legal_documents_write ON legal_documents FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- People record their own acceptances (sign-up, checkout, seller onboarding);
-- guests' are written with their order. Sellers see their business's.
ALTER TABLE policy_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY policy_acceptances_read ON policy_acceptances FOR SELECT USING (
  app_is_privileged() OR user_id = app_current_user_id() OR business_id = app_current_business_id());
CREATE POLICY policy_acceptances_insert ON policy_acceptances FOR INSERT WITH CHECK (
  app_is_privileged()
  OR (user_id = app_current_user_id() AND (business_id IS NULL OR business_id = app_current_business_id()))
  OR (user_id IS NULL AND business_id IS NULL AND order_id IS NOT NULL AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id)));

-- Consent is written by TownMart code (visitors may not be signed in); people read their own.
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_records_read ON consent_records FOR SELECT USING (app_is_privileged() OR user_id = app_current_user_id());
CREATE POLICY consent_records_insert ON consent_records FOR INSERT WITH CHECK (app_is_privileged());

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY notification_preferences_own ON notification_preferences
  USING (user_id = app_current_user_id() OR app_is_privileged())
  WITH CHECK (user_id = app_current_user_id() OR app_is_privileged());

-- Requests move through TownMart's queue; requesters read their own.
ALTER TABLE data_subject_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY dsr_read ON data_subject_requests FOR SELECT USING (app_is_privileged() OR user_id = app_current_user_id());
CREATE POLICY dsr_write ON data_subject_requests FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Compliance records: TownMart staff and jobs only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['marketing_suppressions', 'breach_incidents', 'processing_activities', 'data_processors', 'dpia_records', 'retention_settings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (app_is_privileged()) WITH CHECK (app_is_privileged())', t || '_privileged', t);
  END LOOP;
END $$;

-- Retention jobs scan by these.
CREATE INDEX users_unverified ON users (created_at) WHERE email_verified_at IS NULL;
CREATE INDEX users_pending_deletion ON users (deletion_requested_at) WHERE status = 'pending_deletion';

-- Anonymising an account replaces the reviewer's name on their reviews.
-- Granted for that job (system scope) only; sellers can't touch it.
GRANT UPDATE (author_name) ON reviews TO townmart_app;
CREATE OR REPLACE FUNCTION guard_review_author() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged() AND NEW.author_name IS DISTINCT FROM OLD.author_name THEN
    RAISE EXCEPTION 'Only TownMart can change a review''s author' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_reviews_author BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION guard_review_author();

-- Retention and anonymising delete old or personal notifications (TownMart only).
CREATE POLICY notifications_delete ON notifications FOR DELETE USING (app_is_privileged());
