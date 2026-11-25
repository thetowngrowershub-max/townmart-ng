-- CreateEnum
CREATE TYPE "refund_status" AS ENUM ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "refund_reason" AS ENUM ('cancelled_by_customer', 'cancelled_by_seller', 'booking_cancelled', 'not_received', 'damaged', 'wrong_item', 'not_as_described', 'changed_mind', 'provider_no_show', 'payment_problem', 'other');

-- CreateEnum
CREATE TYPE "refund_origin" AS ENUM ('customer', 'seller', 'admin', 'system');

-- CreateEnum
CREATE TYPE "dispute_status" AS ENUM ('open', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "dispute_outcome" AS ENUM ('refund_full', 'refund_partial', 'no_refund', 'withdrawn');

-- CreateEnum
CREATE TYPE "dispute_party" AS ENUM ('customer', 'seller', 'admin', 'system');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('pending', 'processing', 'paid', 'failed');

-- AlterTable
ALTER TABLE "payout_accounts" ADD COLUMN     "provider_recipient_code" TEXT;

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN     "escrow_released_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "refund_number" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID,
    "business_id" UUID,
    "payment_id" UUID NOT NULL,
    "origin" "refund_origin" NOT NULL,
    "requested_by" UUID,
    "reason" "refund_reason" NOT NULL,
    "details" TEXT,
    "evidence_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requested_kobo" BIGINT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "fee_kobo" BIGINT NOT NULL DEFAULT 0,
    "vat_kobo" BIGINT NOT NULL DEFAULT 0,
    "commission_returned_kobo" BIGINT NOT NULL DEFAULT 0,
    "platform_discount_returned_kobo" BIGINT NOT NULL DEFAULT 0,
    "seller_debit_kobo" BIGINT NOT NULL DEFAULT 0,
    "debited_from" "ledger_account_type",
    "includes_delivery" BOOLEAN NOT NULL DEFAULT false,
    "status" "refund_status" NOT NULL DEFAULT 'requested',
    "response" TEXT,
    "respond_by" TIMESTAMPTZ(6),
    "decided_by" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "provider_refund_reference" TEXT,
    "provider_status" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "refund_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "restock" BOOLEAN NOT NULL DEFAULT false,
    "restocked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "refund_id" UUID,
    "opened_by" UUID,
    "opened_by_party" "dispute_party" NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "dispute_status" NOT NULL DEFAULT 'open',
    "outcome" "dispute_outcome",
    "resolution_note" TEXT,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "dispute_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sender" "dispute_party" NOT NULL,
    "sender_user_id" UUID,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'pending',
    "provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "provider_transfer_code" TEXT,
    "bank_name" TEXT NOT NULL,
    "account_number_last4" CHAR(4) NOT NULL,
    "account_name" TEXT NOT NULL,
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "requested_by" UUID,
    "failure_reason" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refunds_refund_number_key" ON "refunds"("refund_number");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_seller_order_id_idx" ON "refunds"("seller_order_id");

-- CreateIndex
CREATE INDEX "refunds_business_id_status_created_at_idx" ON "refunds"("business_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "refunds_status_respond_by_idx" ON "refunds"("status", "respond_by");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refund_items_order_item_id_business_id_idx" ON "refund_items"("order_item_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_items_refund_id_order_item_id_key" ON "refund_items"("refund_id", "order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "disputes_refund_id_key" ON "disputes"("refund_id");

-- CreateIndex
CREATE INDEX "disputes_status_created_at_idx" ON "disputes"("status", "created_at");

-- CreateIndex
CREATE INDEX "disputes_seller_order_id_idx" ON "disputes"("seller_order_id");

-- CreateIndex
CREATE INDEX "disputes_business_id_status_idx" ON "disputes"("business_id", "status");

-- CreateIndex
CREATE INDEX "disputes_order_id_idx" ON "disputes"("order_id");

-- CreateIndex
CREATE INDEX "dispute_messages_dispute_id_created_at_idx" ON "dispute_messages"("dispute_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_reference_key" ON "payouts"("reference");

-- CreateIndex
CREATE INDEX "payouts_business_id_created_at_idx" ON "payouts"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "payouts_status_created_at_idx" ON "payouts"("status", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_reference_id_idx" ON "ledger_entries"("reference_type", "reference_id");

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_items" ADD CONSTRAINT "refund_items_order_item_id_business_id_fkey" FOREIGN KEY ("order_item_id", "business_id") REFERENCES "order_items"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_seller_order_id_fkey" FOREIGN KEY ("seller_order_id") REFERENCES "seller_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_dispute_id_fkey" FOREIGN KEY ("dispute_id") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


SELECT attach_updated_at_trigger('public.refunds'::regclass);
SELECT attach_updated_at_trigger('public.disputes'::regclass);
SELECT attach_updated_at_trigger('public.payouts'::regclass);

-- ── Refund numbers: RF-2026-000123 ───────────────────────────────────────────
CREATE SEQUENCE refund_number_seq;
CREATE OR REPLACE FUNCTION next_refund_number() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'RF-' || to_char(now() AT TIME ZONE 'Africa/Lagos', 'YYYY') || '-' || lpad(nextval('refund_number_seq')::text, 6, '0')
$$;

-- ── Check constraints ────────────────────────────────────────────────────────
ALTER TABLE refunds ADD CONSTRAINT refunds_amounts CHECK (
  requested_kobo >= 0 AND amount_kobo >= 0 AND fee_kobo >= 0 AND vat_kobo >= 0
  AND (amount_kobo + fee_kobo + vat_kobo > 0 OR status IN ('requested', 'rejected')));
-- Once decided, a goods refund's seller share is the amount plus TownMart-funded discount less commission.
ALTER TABLE refunds ADD CONSTRAINT refunds_split CHECK (
  commission_returned_kobo >= 0 AND platform_discount_returned_kobo >= 0
  AND (reason = 'payment_problem' OR status IN ('requested', 'rejected')
       OR seller_debit_kobo = amount_kobo + platform_discount_returned_kobo - commission_returned_kobo));
-- Goods refunds belong to one seller; payment-problem refunds return a whole payment.
ALTER TABLE refunds ADD CONSTRAINT refunds_target CHECK (
  (reason = 'payment_problem' AND seller_order_id IS NULL AND business_id IS NULL)
  OR (reason <> 'payment_problem' AND seller_order_id IS NOT NULL AND business_id IS NOT NULL));
ALTER TABLE refunds ADD CONSTRAINT refunds_evidence CHECK (cardinality(evidence_keys) <= 4);
ALTER TABLE refunds ADD CONSTRAINT refunds_details CHECK (details IS NULL OR char_length(details) <= 2000);
ALTER TABLE refunds ADD CONSTRAINT refunds_debited_from CHECK (debited_from IS NULL OR debited_from IN ('escrow', 'available'));
ALTER TABLE refund_items ADD CONSTRAINT refund_items_amounts CHECK (qty > 0 AND amount_kobo >= 0);
ALTER TABLE dispute_messages ADD CONSTRAINT dispute_messages_body CHECK (char_length(body) BETWEEN 1 AND 2000);
ALTER TABLE disputes ADD CONSTRAINT disputes_reason CHECK (char_length(reason) BETWEEN 1 AND 2000);
ALTER TABLE payouts ADD CONSTRAINT payouts_amount CHECK (amount_kobo > 0 AND period_end >= period_start);

-- One live refund request per seller order at a time keeps decisions simple.
CREATE UNIQUE INDEX refunds_one_open_per_seller_order ON refunds (seller_order_id) WHERE status = 'requested';
-- One open dispute per seller order.
CREATE UNIQUE INDEX disputes_one_open_per_seller_order ON disputes (seller_order_id) WHERE status = 'open';
-- A business has at most one payout on its way at a time.
CREATE UNIQUE INDEX payouts_one_in_flight ON payouts (business_id) WHERE status IN ('pending', 'processing');

-- ── Append-only thread ───────────────────────────────────────────────────────
CREATE TRIGGER trg_dispute_messages_no_update BEFORE UPDATE ON dispute_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON dispute_messages FROM townmart_app;

-- Releasing escrow is TownMart's job. The column is granted (system code runs
-- as the same database role), and a trigger keeps it to the system scope.
GRANT UPDATE (escrow_released_at) ON seller_orders TO townmart_app;
CREATE OR REPLACE FUNCTION guard_seller_order_money() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged() AND NEW.escrow_released_at IS DISTINCT FROM OLD.escrow_released_at THEN
    RAISE EXCEPTION 'Only TownMart can release escrow' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_seller_orders_money BEFORE UPDATE ON seller_orders
  FOR EACH ROW EXECUTE FUNCTION guard_seller_order_money();

-- ── Row-level security ───────────────────────────────────────────────────────
-- Refunds, disputes and payouts are written only by TownMart code (system or
-- admin scope) after its permission checks: they move money. Customers read
-- their own (through the orders policy), sellers their business's.
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY refunds_read ON refunds FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY refunds_write ON refunds FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE refund_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY refund_items_read ON refund_items FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM refunds r WHERE r.id = refund_id));
CREATE POLICY refund_items_write ON refund_items FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY disputes_read ON disputes FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY disputes_write ON disputes FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Each side writes as itself; TownMart (and guests, checked by their order link) through the system scope.
ALTER TABLE dispute_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY dispute_messages_read ON dispute_messages FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM disputes d WHERE d.id = dispute_id));
CREATE POLICY dispute_messages_insert ON dispute_messages FOR INSERT WITH CHECK (
  app_is_privileged()
  OR (sender = 'seller' AND business_id = app_current_business_id() AND sender_user_id = app_current_user_id()
      AND EXISTS (SELECT 1 FROM disputes d WHERE d.id = dispute_id AND d.business_id = dispute_messages.business_id AND d.status = 'open'))
  OR (sender = 'customer' AND sender_user_id = app_current_user_id()
      AND EXISTS (SELECT 1 FROM disputes d JOIN orders o ON o.id = d.order_id
                  WHERE d.id = dispute_id AND d.business_id = dispute_messages.business_id AND d.status = 'open' AND o.user_id = app_current_user_id())));

ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY payouts_read ON payouts FOR SELECT USING (business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY payouts_write ON payouts FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

-- Escrow release and payout runs scan by these.
CREATE INDEX seller_orders_escrow_due ON seller_orders (escrow_release_at) WHERE escrow_released_at IS NULL AND escrow_release_at IS NOT NULL;
