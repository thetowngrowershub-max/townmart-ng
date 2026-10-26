-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending_payment', 'paid', 'processing', 'ready_for_pickup', 'shipped', 'delivered', 'completed', 'cancelled', 'refund_requested', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "order_payment_status" AS ENUM ('unpaid', 'paid', 'failed', 'pay_on_delivery', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('paystack', 'flutterwave', 'pay_on_delivery', 'fake');

-- CreateEnum
CREATE TYPE "payment_state" AS ENUM ('initiated', 'success', 'failed', 'abandoned', 'reversed');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('held', 'converted', 'released');

-- CreateEnum
CREATE TYPE "delivery_method" AS ENUM ('delivery', 'pickup');

-- CreateEnum
CREATE TYPE "commission_scope" AS ENUM ('global', 'category', 'business');

-- CreateEnum
CREATE TYPE "ledger_owner_type" AS ENUM ('platform', 'business', 'customer', 'provider_clearing');

-- CreateEnum
CREATE TYPE "ledger_account_type" AS ENUM ('escrow', 'available', 'commission', 'refunds', 'fees', 'tax', 'promotions', 'clearing');

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID,
    "guest_token_hash" TEXT,
    "coupon_code" CITEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "saved_for_later" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "variant_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'held',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_number" TEXT NOT NULL,
    "user_id" UUID,
    "contact_email" CITEXT NOT NULL,
    "contact_phone_encrypted" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "is_guest" BOOLEAN NOT NULL DEFAULT false,
    "shipping_address_snapshot" JSONB NOT NULL,
    "subtotal_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL,
    "delivery_kobo" BIGINT NOT NULL,
    "service_fee_kobo" BIGINT NOT NULL,
    "vat_kobo" BIGINT NOT NULL,
    "total_kobo" BIGINT NOT NULL,
    "payment_status" "order_payment_status" NOT NULL DEFAULT 'unpaid',
    "payment_method" "payment_provider" NOT NULL,
    "coupon_code" CITEXT,
    "promotion_plan" JSONB NOT NULL DEFAULT '[]',
    "terms_version" TEXT NOT NULL,
    "refund_policy_version" TEXT NOT NULL,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "access_token_hash" TEXT NOT NULL,
    "ip_hash" TEXT,
    "placed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payment_due_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_orders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "pay_on_delivery" BOOLEAN NOT NULL DEFAULT false,
    "status" "order_status" NOT NULL DEFAULT 'pending_payment',
    "subtotal_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL,
    "platform_discount_kobo" BIGINT NOT NULL DEFAULT 0,
    "delivery_kobo" BIGINT NOT NULL,
    "commission_kobo" BIGINT NOT NULL,
    "seller_net_kobo" BIGINT NOT NULL,
    "delivery_method" "delivery_method" NOT NULL,
    "eta_days_min" SMALLINT,
    "eta_days_max" SMALLINT,
    "tracking_number" TEXT,
    "delivered_at" TIMESTAMPTZ(6),
    "escrow_release_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "seller_order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_id" UUID,
    "snapshot" JSONB NOT NULL,
    "unit_price_kobo" BIGINT NOT NULL,
    "qty" DECIMAL(12,3) NOT NULL,
    "subtotal_kobo" BIGINT NOT NULL,
    "discount_kobo" BIGINT NOT NULL,
    "line_total_kobo" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "seller_order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status" NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "amount_kobo" BIGINT NOT NULL,
    "status" "payment_state" NOT NULL DEFAULT 'initiated',
    "channel" TEXT,
    "paid_at" TIMESTAMPTZ(6),
    "raw_verification" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "provider" "payment_provider" NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "reference" TEXT,
    "signature_valid" BOOLEAN NOT NULL,
    "payload" JSONB NOT NULL,
    "processed_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_rules" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "scope" "commission_scope" NOT NULL,
    "category_id" UUID,
    "business_id" UUID,
    "percent_bps" INTEGER NOT NULL,
    "fixed_kobo" BIGINT NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_zones" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "state_ids" SMALLINT[],
    "lga_ids" SMALLINT[],
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_rates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "zone_id" UUID NOT NULL,
    "business_id" UUID,
    "min_weight_g" INTEGER NOT NULL DEFAULT 0,
    "max_weight_g" INTEGER,
    "fee_kobo" BIGINT NOT NULL,
    "free_over_kobo" BIGINT,
    "eta_days_min" SMALLINT NOT NULL,
    "eta_days_max" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "owner_type" "ledger_owner_type" NOT NULL,
    "owner_id" UUID,
    "owner_key" TEXT NOT NULL DEFAULT '',
    "type" "ledger_account_type" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "kind" TEXT NOT NULL,
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "business_id" UUID,
    "debit_kobo" BIGINT NOT NULL DEFAULT 0,
    "credit_kobo" BIGINT NOT NULL DEFAULT 0,
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_user_id_key" ON "carts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "carts_guest_token_hash_key" ON "carts"("guest_token_hash");

-- CreateIndex
CREATE INDEX "carts_expires_at_idx" ON "carts"("expires_at");

-- CreateIndex
CREATE INDEX "cart_items_variant_id_business_id_idx" ON "cart_items"("variant_id", "business_id");

-- CreateIndex
CREATE INDEX "cart_items_business_id_idx" ON "cart_items"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- CreateIndex
CREATE INDEX "stock_reservations_order_id_idx" ON "stock_reservations"("order_id");

-- CreateIndex
CREATE INDEX "stock_reservations_variant_id_business_id_idx" ON "stock_reservations"("variant_id", "business_id");

-- CreateIndex
CREATE INDEX "stock_reservations_seller_order_id_business_id_idx" ON "stock_reservations"("seller_order_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_user_id_placed_at_idx" ON "orders"("user_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_payment_status_payment_due_at_idx" ON "orders"("payment_status", "payment_due_at");

-- CreateIndex
CREATE INDEX "seller_orders_business_id_status_created_at_idx" ON "seller_orders"("business_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "seller_orders_order_id_business_id_key" ON "seller_orders"("order_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_orders_id_business_key" ON "seller_orders"("id", "business_id");

-- CreateIndex
CREATE INDEX "order_items_seller_order_id_business_id_idx" ON "order_items"("seller_order_id", "business_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE INDEX "order_status_history_seller_order_id_business_id_created_at_idx" ON "order_status_history"("seller_order_id", "business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_reference_key" ON "payments"("provider_reference");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payment_events_reference_idx" ON "payment_events"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- CreateIndex
CREATE INDEX "commission_rules_scope_effective_from_idx" ON "commission_rules"("scope", "effective_from");

-- CreateIndex
CREATE INDEX "commission_rules_category_id_idx" ON "commission_rules"("category_id");

-- CreateIndex
CREATE INDEX "commission_rules_business_id_idx" ON "commission_rules"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_zones_slug_key" ON "delivery_zones"("slug");

-- CreateIndex
CREATE INDEX "delivery_rates_zone_id_business_id_min_weight_g_idx" ON "delivery_rates"("zone_id", "business_id", "min_weight_g");

-- CreateIndex
CREATE INDEX "delivery_rates_business_id_idx" ON "delivery_rates"("business_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_owner_id_idx" ON "ledger_accounts"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_kind_reference_type_reference_id_key" ON "ledger_transactions"("kind", "reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_business_id_created_at_idx" ON "ledger_entries"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_zones_states" ON "delivery_zones" USING GIN ("state_ids");

-- CreateIndex
CREATE INDEX "delivery_zones_lgas" ON "delivery_zones" USING GIN ("lga_ids");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_owner_type_owner_key_type_key" ON "ledger_accounts"("owner_type", "owner_key", "type");

-- CreateIndex
CREATE INDEX "promotion_redemptions_order_id_idx" ON "promotion_redemptions"("order_id");

-- AddForeignKey
ALTER TABLE "promotion_redemptions" ADD CONSTRAINT "promotion_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_business_id_fkey" FOREIGN KEY ("variant_id", "business_id") REFERENCES "product_variants"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_business_id_fkey" FOREIGN KEY ("variant_id", "business_id") REFERENCES "product_variants"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_seller_order_id_business_id_fkey" FOREIGN KEY ("seller_order_id", "business_id") REFERENCES "seller_orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_seller_order_id_business_id_fkey" FOREIGN KEY ("seller_order_id", "business_id") REFERENCES "seller_orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_seller_order_id_business_id_fkey" FOREIGN KEY ("seller_order_id", "business_id") REFERENCES "seller_orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "delivery_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_rates" ADD CONSTRAINT "delivery_rates_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Raw SQL that Prisma cannot express
-- ═════════════════════════════════════════════════════════════════════════════

-- ── updated_at triggers ──────────────────────────────────────────────────────
SELECT attach_updated_at_trigger('public.carts'::regclass);
SELECT attach_updated_at_trigger('public.cart_items'::regclass);
SELECT attach_updated_at_trigger('public.stock_reservations'::regclass);
SELECT attach_updated_at_trigger('public.orders'::regclass);
SELECT attach_updated_at_trigger('public.seller_orders'::regclass);
SELECT attach_updated_at_trigger('public.payments'::regclass);
SELECT attach_updated_at_trigger('public.delivery_zones'::regclass);
SELECT attach_updated_at_trigger('public.delivery_rates'::regclass);

-- ── Order numbers: TM-2026-000123 ────────────────────────────────────────────
CREATE SEQUENCE order_number_seq;
CREATE OR REPLACE FUNCTION next_order_number() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'TM-' || to_char(now() AT TIME ZONE 'Africa/Lagos', 'YYYY') || '-' || lpad(nextval('order_number_seq')::text, 6, '0')
$$;

-- ── Check constraints ────────────────────────────────────────────────────────
ALTER TABLE carts ADD CONSTRAINT carts_owner CHECK (num_nonnulls(user_id, guest_token_hash) = 1);
ALTER TABLE cart_items ADD CONSTRAINT cart_items_qty CHECK (qty > 0);
ALTER TABLE stock_reservations ADD CONSTRAINT stock_reservations_qty CHECK (qty > 0);
ALTER TABLE orders ADD CONSTRAINT orders_amounts CHECK (
  subtotal_kobo >= 0 AND discount_kobo >= 0 AND discount_kobo <= subtotal_kobo AND delivery_kobo >= 0
  AND service_fee_kobo >= 0 AND vat_kobo >= 0
  AND total_kobo = subtotal_kobo - discount_kobo + delivery_kobo + service_fee_kobo + vat_kobo);
ALTER TABLE seller_orders ADD CONSTRAINT seller_orders_amounts CHECK (
  subtotal_kobo >= 0 AND discount_kobo >= 0 AND discount_kobo <= subtotal_kobo
  AND platform_discount_kobo >= 0 AND platform_discount_kobo <= discount_kobo
  AND delivery_kobo >= 0 AND commission_kobo >= 0
  AND seller_net_kobo = subtotal_kobo - (discount_kobo - platform_discount_kobo) + delivery_kobo - commission_kobo);
ALTER TABLE order_items ADD CONSTRAINT order_items_amounts CHECK (
  qty > 0 AND unit_price_kobo >= 0 AND discount_kobo >= 0 AND discount_kobo <= subtotal_kobo
  AND line_total_kobo = subtotal_kobo - discount_kobo);
ALTER TABLE payments ADD CONSTRAINT payments_amount CHECK (amount_kobo > 0);
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_scope CHECK (
  (scope = 'global' AND category_id IS NULL AND business_id IS NULL)
  OR (scope = 'category' AND category_id IS NOT NULL AND business_id IS NULL)
  OR (scope = 'business' AND business_id IS NOT NULL AND category_id IS NULL));
ALTER TABLE commission_rules ADD CONSTRAINT commission_rules_amounts CHECK (percent_bps BETWEEN 0 AND 5000 AND fixed_kobo >= 0);
ALTER TABLE delivery_rates ADD CONSTRAINT delivery_rates_values CHECK (
  min_weight_g >= 0 AND (max_weight_g IS NULL OR max_weight_g > min_weight_g) AND fee_kobo >= 0
  AND (free_over_kobo IS NULL OR free_over_kobo > 0) AND eta_days_min >= 0 AND eta_days_max >= eta_days_min);
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner CHECK (
  (owner_type = 'business' AND owner_id IS NOT NULL AND owner_key = owner_id::text)
  OR (owner_type = 'provider_clearing' AND owner_id IS NULL AND owner_key <> '')
  OR (owner_type IN ('platform', 'customer') AND owner_id IS NULL AND owner_key = ''));
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_entries_one_side CHECK (
  debit_kobo >= 0 AND credit_kobo >= 0 AND (debit_kobo = 0) <> (credit_kobo = 0));

-- The expiry job scans live holds only.
CREATE INDEX stock_reservations_held ON stock_reservations (expires_at) WHERE status = 'held';

-- ── Ledger: balanced and append-only ─────────────────────────────────────────
-- Every transaction's debits equal its credits, checked when the database
-- transaction commits (so all entries of one ledger transaction can be inserted first).
CREATE OR REPLACE FUNCTION ledger_check_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  d numeric;
  c numeric;
BEGIN
  SELECT coalesce(sum(debit_kobo), 0), coalesce(sum(credit_kobo), 0) INTO d, c
    FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF d <> c THEN
    RAISE EXCEPTION 'ledger transaction % is unbalanced (debits %, credits %)', NEW.transaction_id, d, c
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- business_id on an entry always matches its account.
CREATE OR REPLACE FUNCTION ledger_entry_business() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.business_id := (SELECT CASE WHEN owner_type = 'business' THEN owner_id END FROM ledger_accounts WHERE id = NEW.account_id);
  RETURN NEW;
END $$;
CREATE TRIGGER trg_ledger_entries_business BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entry_business();

-- Corrections are new, reversing transactions; nothing is ever edited.
CREATE TRIGGER trg_ledger_entries_no_update BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_ledger_transactions_no_update BEFORE UPDATE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER trg_order_status_history_no_update BEFORE UPDATE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON ledger_accounts, ledger_transactions, ledger_entries, order_status_history, payment_events FROM townmart_app;
GRANT UPDATE (processed_at, error) ON payment_events TO townmart_app;

-- ── Row-level security ───────────────────────────────────────────────────────
-- A guest's cart is identified by app.current_cart_id, set only after the
-- server has matched the hash of the guest's cookie token (or, for a new
-- cart, to the id the server is about to insert).
CREATE OR REPLACE FUNCTION app_current_cart_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_cart_id', true), '')::uuid
$$;

ALTER TABLE carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY carts_owner ON carts
  USING (user_id = app_current_user_id() OR id = app_current_cart_id() OR app_is_privileged())
  WITH CHECK (user_id = app_current_user_id() OR (user_id IS NULL AND id = app_current_cart_id()) OR app_is_privileged());

ALTER TABLE cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY cart_items_owner ON cart_items
  USING (EXISTS (SELECT 1 FROM carts c WHERE c.id = cart_id))
  WITH CHECK (EXISTS (SELECT 1 FROM carts c WHERE c.id = cart_id));

-- Orders are written by checkout in the system scope. Customers read their
-- own; sellers read only their part (seller_orders, order_items).
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_read ON orders FOR SELECT USING (user_id = app_current_user_id() OR app_is_privileged());
CREATE POLICY orders_write ON orders FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE seller_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY seller_orders_read ON seller_orders FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY seller_orders_write ON seller_orders FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_items_read ON order_items FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM seller_orders so JOIN orders o ON o.id = so.order_id WHERE so.id = seller_order_id));
CREATE POLICY order_items_write ON order_items FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY order_status_history_read ON order_status_history FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM seller_orders so JOIN orders o ON o.id = so.order_id WHERE so.id = seller_order_id));
CREATE POLICY order_status_history_insert ON order_status_history FOR INSERT WITH CHECK (app_is_privileged());

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_read ON stock_reservations FOR SELECT USING (business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY stock_reservations_write ON stock_reservations FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_read ON payments FOR SELECT USING (app_is_privileged() OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY payments_write ON payments FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_events_privileged ON payment_events USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_accounts_read ON ledger_accounts FOR SELECT USING (
  (owner_type = 'business' AND owner_id = app_current_business_id()) OR app_is_privileged());
CREATE POLICY ledger_accounts_insert ON ledger_accounts FOR INSERT WITH CHECK (app_is_privileged());

ALTER TABLE ledger_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_transactions_read ON ledger_transactions FOR SELECT USING (
  app_is_privileged() OR EXISTS (SELECT 1 FROM ledger_entries e WHERE e.transaction_id = ledger_transactions.id AND e.business_id = app_current_business_id()));
CREATE POLICY ledger_transactions_insert ON ledger_transactions FOR INSERT WITH CHECK (app_is_privileged());

ALTER TABLE ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY ledger_entries_read ON ledger_entries FOR SELECT USING (business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY ledger_entries_insert ON ledger_entries FOR INSERT WITH CHECK (app_is_privileged());

-- Rates and zones are public (shoppers see delivery fees); commission rates are
-- shown to sellers. Platform rows are admin/system only.
ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_zones_read ON delivery_zones FOR SELECT USING (true);
CREATE POLICY delivery_zones_write ON delivery_zones FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE delivery_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY delivery_rates_read ON delivery_rates FOR SELECT USING (true);
CREATE POLICY delivery_rates_write ON delivery_rates FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

ALTER TABLE commission_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY commission_rules_read ON commission_rules FOR SELECT USING (
  business_id IS NULL OR business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY commission_rules_write ON commission_rules FOR ALL USING (app_is_privileged()) WITH CHECK (app_is_privileged());

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY notifications_read ON notifications FOR SELECT USING (user_id = app_current_user_id() OR app_is_privileged());
CREATE POLICY notifications_mark_read ON notifications FOR UPDATE
  USING (user_id = app_current_user_id() OR app_is_privileged())
  WITH CHECK (user_id = app_current_user_id() OR app_is_privileged());
CREATE POLICY notifications_insert ON notifications FOR INSERT WITH CHECK (app_is_privileged());
REVOKE UPDATE ON notifications FROM townmart_app;
GRANT UPDATE (read_at) ON notifications TO townmart_app;
