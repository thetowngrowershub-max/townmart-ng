-- CreateEnum
CREATE TYPE "booking_status" AS ENUM ('held', 'requested', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show', 'rescheduled');

-- CreateEnum
CREATE TYPE "message_sender" AS ENUM ('customer', 'seller', 'system');

-- CreateEnum
CREATE TYPE "review_target" AS ENUM ('product', 'service');

-- CreateEnum
CREATE TYPE "review_status" AS ENUM ('published', 'reported', 'hidden');

-- AlterEnum
ALTER TYPE "delivery_method" ADD VALUE 'none';

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "at_provider" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "booking_starts_at" TIMESTAMPTZ(6),
ADD COLUMN     "package_id" UUID,
ADD COLUMN     "service_id" UUID,
ALTER COLUMN "variant_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "package_id" UUID,
ADD COLUMN     "service_id" UUID;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "pay_later_kobo" BIGINT NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "cash_collected_at" TIMESTAMPTZ(6),
ADD COLUMN     "completed_at" TIMESTAMPTZ(6),
ADD COLUMN     "fulfilment_contact" JSONB,
ADD COLUMN     "pay_later_kobo" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "shipped_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "bookings" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "order_id" UUID NOT NULL,
    "seller_order_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "package_id" UUID,
    "customer_user_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "slot_no" SMALLINT NOT NULL DEFAULT 1,
    "capacity" SMALLINT NOT NULL DEFAULT 1,
    "status" "booking_status" NOT NULL DEFAULT 'held',
    "at_provider" BOOLEAN NOT NULL DEFAULT false,
    "location_snapshot" JSONB NOT NULL,
    "price_kobo" BIGINT NOT NULL,
    "deposit_kobo" BIGINT NOT NULL DEFAULT 0,
    "balance_kobo" BIGINT NOT NULL DEFAULT 0,
    "hold_expires_at" TIMESTAMPTZ(6),
    "previous_starts_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "reminder_24_sent_at" TIMESTAMPTZ(6),
    "reminder_1_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_status_history" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "booking_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "from_status" "booking_status",
    "to_status" "booking_status" NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "booking_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "seller_order_id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "sender_user_id" UUID,
    "sender" "message_sender" NOT NULL,
    "body" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "target_type" "review_target" NOT NULL,
    "product_id" UUID,
    "service_id" UUID,
    "business_id" UUID NOT NULL,
    "order_item_id" UUID,
    "booking_id" UUID,
    "user_id" UUID,
    "author_name" TEXT NOT NULL,
    "rating" SMALLINT NOT NULL,
    "body" TEXT NOT NULL,
    "image_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "review_status" NOT NULL DEFAULT 'published',
    "seller_reply" TEXT,
    "seller_replied_at" TIMESTAMPTZ(6),
    "report_reason" TEXT,
    "reported_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wishlist_items" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "user_id" UUID NOT NULL,
    "product_id" UUID,
    "service_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wishlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bookings_order_item_id_key" ON "bookings"("order_item_id");

-- CreateIndex
CREATE INDEX "bookings_seller_order_id_business_id_idx" ON "bookings"("seller_order_id", "business_id");

-- CreateIndex
CREATE INDEX "bookings_order_id_idx" ON "bookings"("order_id");

-- CreateIndex
CREATE INDEX "bookings_service_id_business_id_starts_at_idx" ON "bookings"("service_id", "business_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_package_id_idx" ON "bookings"("package_id");

-- CreateIndex
CREATE INDEX "bookings_business_id_status_starts_at_idx" ON "bookings"("business_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_customer_user_id_starts_at_idx" ON "bookings"("customer_user_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_status_starts_at_idx" ON "bookings"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_order_item_id_business_id_key" ON "bookings"("order_item_id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_id_business_key" ON "bookings"("id", "business_id");

-- CreateIndex
CREATE INDEX "booking_status_history_booking_id_business_id_created_at_idx" ON "booking_status_history"("booking_id", "business_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_seller_order_id_business_id_created_at_idx" ON "messages"("seller_order_id", "business_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_business_id_created_at_idx" ON "messages"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_order_item_id_key" ON "reviews"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_booking_id_key" ON "reviews"("booking_id");

-- CreateIndex
CREATE INDEX "reviews_product_id_status_created_at_idx" ON "reviews"("product_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_service_id_status_created_at_idx" ON "reviews"("service_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "reviews_business_id_created_at_idx" ON "reviews"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "reviews_user_id_idx" ON "reviews"("user_id");

-- CreateIndex
CREATE INDEX "wishlist_items_product_id_idx" ON "wishlist_items"("product_id");

-- CreateIndex
CREATE INDEX "wishlist_items_service_id_idx" ON "wishlist_items"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_product_id_key" ON "wishlist_items"("user_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "wishlist_items_user_id_service_id_key" ON "wishlist_items"("user_id", "service_id");

-- CreateIndex
CREATE INDEX "cart_items_service_id_business_id_idx" ON "cart_items"("service_id", "business_id");

-- CreateIndex
CREATE INDEX "cart_items_package_id_idx" ON "cart_items"("package_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_service_id_idx" ON "order_items"("service_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_id_business_key" ON "order_items"("id", "business_id");

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "service_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_seller_order_id_business_id_fkey" FOREIGN KEY ("seller_order_id", "business_id") REFERENCES "seller_orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_order_item_id_business_id_fkey" FOREIGN KEY ("order_item_id", "business_id") REFERENCES "order_items"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "service_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_user_id_fkey" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_status_history" ADD CONSTRAINT "booking_status_history_booking_id_business_id_fkey" FOREIGN KEY ("booking_id", "business_id") REFERENCES "bookings"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_seller_order_id_business_id_fkey" FOREIGN KEY ("seller_order_id", "business_id") REFERENCES "seller_orders"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═════════════════════════════════════════════════════════════════════════════
-- Raw SQL that Prisma cannot express
-- ═════════════════════════════════════════════════════════════════════════════

-- ── updated_at triggers ──────────────────────────────────────────────────────
SELECT attach_updated_at_trigger('public.bookings'::regclass);
SELECT attach_updated_at_trigger('public.reviews'::regclass);

-- ── Check constraints ────────────────────────────────────────────────────────
ALTER TABLE cart_items ADD CONSTRAINT cart_items_kind CHECK (
  num_nonnulls(variant_id, service_id) = 1
  AND (service_id IS NULL OR booking_starts_at IS NOT NULL)
  AND (package_id IS NULL OR service_id IS NOT NULL));

-- Booking balances paid to the provider on the day are not part of what's charged at checkout.
ALTER TABLE orders DROP CONSTRAINT orders_amounts;
ALTER TABLE orders ADD CONSTRAINT orders_amounts CHECK (
  subtotal_kobo >= 0 AND discount_kobo >= 0 AND discount_kobo <= subtotal_kobo AND delivery_kobo >= 0
  AND service_fee_kobo >= 0 AND vat_kobo >= 0 AND pay_later_kobo >= 0
  AND total_kobo = subtotal_kobo - discount_kobo + delivery_kobo + service_fee_kobo + vat_kobo - pay_later_kobo);
ALTER TABLE seller_orders ADD CONSTRAINT seller_orders_pay_later CHECK (pay_later_kobo >= 0);
ALTER TABLE order_items ADD CONSTRAINT order_items_kind CHECK (
  (variant_id IS NULL OR service_id IS NULL) AND (package_id IS NULL OR service_id IS NOT NULL));

ALTER TABLE bookings ADD CONSTRAINT bookings_times CHECK (ends_at > starts_at);
ALTER TABLE bookings ADD CONSTRAINT bookings_slot CHECK (capacity >= 1 AND slot_no BETWEEN 1 AND capacity);
ALTER TABLE bookings ADD CONSTRAINT bookings_amounts CHECK (
  price_kobo >= 0 AND deposit_kobo >= 0 AND balance_kobo >= 0 AND deposit_kobo + balance_kobo = price_kobo);

-- No double-booking: two active bookings of the same service can't hold the
-- same capacity place at overlapping times. With capacity N, places 1..N exist,
-- so at most N bookings can overlap.
ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
  service_id WITH =,
  slot_no WITH =,
  tstzrange(starts_at, ends_at, '[)') WITH &&
) WHERE (status IN ('held', 'requested', 'confirmed', 'in_progress'));

ALTER TABLE messages ADD CONSTRAINT messages_body CHECK (char_length(body) BETWEEN 1 AND 2000);

ALTER TABLE reviews ADD CONSTRAINT reviews_rating CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE reviews ADD CONSTRAINT reviews_body CHECK (char_length(body) BETWEEN 1 AND 2000 AND cardinality(image_keys) <= 4);
ALTER TABLE reviews ADD CONSTRAINT reviews_target CHECK (
  (target_type = 'product' AND product_id IS NOT NULL AND service_id IS NULL AND order_item_id IS NOT NULL AND booking_id IS NULL)
  OR (target_type = 'service' AND service_id IS NOT NULL AND product_id IS NULL AND booking_id IS NOT NULL));

ALTER TABLE wishlist_items ADD CONSTRAINT wishlist_items_target CHECK (num_nonnulls(product_id, service_id) = 1);

-- ── Status rules for sellers ─────────────────────────────────────────────────
-- Sellers move their own orders and bookings forward one step at a time.
-- Anything else (completing, cancelling, rescheduling) goes through TownMart
-- code in the admin/system scope, which also handles money and stock.
CREATE OR REPLACE FUNCTION guard_seller_order_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_privileged() OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) IN (
       ('paid'::order_status, 'processing'::order_status),
       ('processing', 'shipped'), ('processing', 'ready_for_pickup'),
       ('shipped', 'delivered'), ('ready_for_pickup', 'delivered')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A seller can''t move an order from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_seller_orders_status BEFORE UPDATE OF status ON seller_orders
  FOR EACH ROW EXECUTE FUNCTION guard_seller_order_status();

CREATE OR REPLACE FUNCTION guard_booking_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_privileged() OR NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) IN (
       ('requested'::booking_status, 'confirmed'::booking_status),
       ('confirmed', 'in_progress'), ('confirmed', 'no_show'),
       ('in_progress', 'completed')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'A seller can''t move a booking from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER trg_bookings_status BEFORE UPDATE OF status ON bookings
  FOR EACH ROW EXECUTE FUNCTION guard_booking_status();

-- ── Append-only history and messages ─────────────────────────────────────────
CREATE TRIGGER trg_booking_status_history_no_update BEFORE UPDATE ON booking_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
REVOKE UPDATE, DELETE, TRUNCATE ON booking_status_history FROM townmart_app;
REVOKE UPDATE, DELETE, TRUNCATE ON messages FROM townmart_app;
GRANT UPDATE (read_at) ON messages TO townmart_app;

-- Sellers may change only these columns of their orders, bookings and reviews.
REVOKE UPDATE ON seller_orders FROM townmart_app;
GRANT UPDATE (status, tracking_number, carrier, shipped_at, delivered_at, completed_at, cash_collected_at, escrow_release_at, updated_at) ON seller_orders TO townmart_app;
REVOKE UPDATE ON bookings FROM townmart_app;
GRANT UPDATE (status, cancel_reason, reminder_24_sent_at, reminder_1_sent_at, hold_expires_at, updated_at) ON bookings TO townmart_app;
-- Moving a booking (and retaking a place after a late payment) changes its
-- time and place. Column grants can't tell the system scope from a seller, so
-- these are granted and a trigger keeps them to TownMart code.
GRANT UPDATE (starts_at, ends_at, slot_no, capacity, previous_starts_at) ON bookings TO townmart_app;
CREATE OR REPLACE FUNCTION guard_booking_time() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged() AND (NEW.starts_at, NEW.ends_at, NEW.slot_no, NEW.capacity, NEW.previous_starts_at)
       IS DISTINCT FROM (OLD.starts_at, OLD.ends_at, OLD.slot_no, OLD.capacity, OLD.previous_starts_at) THEN
    RAISE EXCEPTION 'Only TownMart can move a booking' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_bookings_time BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION guard_booking_time();
REVOKE UPDATE ON reviews FROM townmart_app;
GRANT UPDATE (seller_reply, seller_replied_at, status, report_reason, reported_at, updated_at) ON reviews TO townmart_app;

-- ── Row-level security ───────────────────────────────────────────────────────
CREATE POLICY seller_orders_seller_update ON seller_orders FOR UPDATE
  USING (business_id = app_current_business_id())
  WITH CHECK (business_id = app_current_business_id());

DROP POLICY order_status_history_insert ON order_status_history;
CREATE POLICY order_status_history_insert ON order_status_history FOR INSERT
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY bookings_read ON bookings FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR customer_user_id = app_current_user_id()
  OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
CREATE POLICY bookings_seller_update ON bookings FOR UPDATE
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY bookings_insert ON bookings FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY bookings_delete ON bookings FOR DELETE USING (app_is_privileged());

ALTER TABLE booking_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY booking_status_history_read ON booking_status_history FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id));
CREATE POLICY booking_status_history_insert ON booking_status_history FOR INSERT
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());

-- A conversation is between the order's customer and the seller.
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_read ON messages FOR SELECT USING (
  business_id = app_current_business_id() OR app_is_privileged()
  OR EXISTS (SELECT 1 FROM seller_orders so JOIN orders o ON o.id = so.order_id WHERE so.id = seller_order_id));
CREATE POLICY messages_insert ON messages FOR INSERT WITH CHECK (
  app_is_privileged()
  OR (sender = 'seller' AND business_id = app_current_business_id() AND sender_user_id = app_current_user_id())
  OR (sender = 'customer' AND sender_user_id = app_current_user_id()
      AND EXISTS (SELECT 1 FROM seller_orders so JOIN orders o ON o.id = so.order_id
                  WHERE so.id = seller_order_id AND so.business_id = messages.business_id AND o.user_id = app_current_user_id())));
CREATE POLICY messages_mark_read ON messages FOR UPDATE
  USING (business_id = app_current_business_id() OR app_is_privileged()
         OR EXISTS (SELECT 1 FROM seller_orders so JOIN orders o ON o.id = so.order_id WHERE so.id = seller_order_id))
  WITH CHECK (true);

-- Published and reported reviews are public; hidden ones only to their author,
-- the seller and moderators. Reviews are written by TownMart code after it
-- checks the purchase; a seller may only reply.
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY reviews_read ON reviews FOR SELECT USING (
  status <> 'hidden' OR user_id = app_current_user_id()
  OR business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY reviews_insert ON reviews FOR INSERT WITH CHECK (app_is_privileged());
CREATE POLICY reviews_update ON reviews FOR UPDATE
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());
CREATE POLICY reviews_delete ON reviews FOR DELETE USING (app_is_privileged());

-- A seller replying can't also change a review's status.
CREATE OR REPLACE FUNCTION guard_review_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT app_is_privileged() AND (NEW.status IS DISTINCT FROM OLD.status
       OR NEW.report_reason IS DISTINCT FROM OLD.report_reason OR NEW.reported_at IS DISTINCT FROM OLD.reported_at) THEN
    RAISE EXCEPTION 'Only TownMart can change a review''s status' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_reviews_guard BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION guard_review_update();

ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY wishlist_items_owner ON wishlist_items
  USING (user_id = app_current_user_id() OR app_is_privileged())
  WITH CHECK (user_id = app_current_user_id() OR app_is_privileged());

-- ── Ratings ──────────────────────────────────────────────────────────────────
-- Recomputed from published and reported reviews by TownMart code (system
-- scope) whenever a review is written or moderated.
CREATE OR REPLACE FUNCTION refresh_ratings(p_business uuid, p_product uuid, p_service uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_product IS NOT NULL THEN
    UPDATE products SET (rating_avg, rating_count) = (
      SELECT COALESCE(round(avg(rating), 2), 0), count(*) FROM reviews WHERE product_id = p_product AND status <> 'hidden')
    WHERE id = p_product;
  END IF;
  IF p_service IS NOT NULL THEN
    UPDATE services SET (rating_avg, rating_count) = (
      SELECT COALESCE(round(avg(rating), 2), 0), count(*) FROM reviews WHERE service_id = p_service AND status <> 'hidden')
    WHERE id = p_service;
  END IF;
  UPDATE businesses SET (rating_avg, rating_count) = (
    SELECT COALESCE(round(avg(rating), 2), 0), count(*) FROM reviews WHERE business_id = p_business AND status <> 'hidden')
  WHERE id = p_business;
END $$;
