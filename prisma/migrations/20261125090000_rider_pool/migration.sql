-- The TownMart rider pool: riders who belong to no shop, sign in, are vetted
-- by TownMart and take any shop's deliveries (lib/riders/pool.ts).
-- DropForeignKey
ALTER TABLE "seller_orders" DROP CONSTRAINT "seller_orders_rider_same_business";

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "rider_mode" TEXT NOT NULL DEFAULT 'townmart';

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "applied_at" TIMESTAMPTZ(6),
ADD COLUMN     "guarantor_name" TEXT,
ADD COLUMN     "guarantor_phone_encrypted" TEXT,
ADD COLUMN     "home_town" TEXT,
ADD COLUMN     "nin_encrypted" TEXT,
ADD COLUMN     "plate_number" TEXT,
ADD COLUMN     "review_note" TEXT,
ADD COLUMN     "reviewed_at" TIMESTAMPTZ(6),
ADD COLUMN     "reviewed_by_user_id" UUID,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'approved',
ADD COLUMN     "user_id" UUID,
ALTER COLUMN "business_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN     "rider_pay_kobo" BIGINT,
ADD COLUMN     "rider_pool_opened_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "riders_user_id_key" ON "riders"("user_id");

-- CreateIndex
CREATE INDEX "riders_status_idx" ON "riders"("status");

-- CreateIndex
CREATE INDEX "seller_orders_rider_pool_opened_at_idx" ON "seller_orders"("rider_pool_opened_at");

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Rules the app relies on ──────────────────────────────────────────────────
ALTER TABLE riders ADD CONSTRAINT riders_status CHECK (status IN ('pending', 'approved', 'suspended', 'rejected'));
-- Shop riders have no sign-in and need no vetting; pool riders always have a sign-in.
ALTER TABLE riders ADD CONSTRAINT riders_kind CHECK (
  (business_id IS NOT NULL AND user_id IS NULL AND status = 'approved') OR (business_id IS NULL AND user_id IS NOT NULL));
ALTER TABLE riders ADD CONSTRAINT riders_plate_length CHECK (plate_number IS NULL OR length(plate_number) <= 20);
ALTER TABLE riders ADD CONSTRAINT riders_home_town_length CHECK (home_town IS NULL OR length(home_town) <= 80);
ALTER TABLE riders ADD CONSTRAINT riders_guarantor_name_length CHECK (guarantor_name IS NULL OR length(guarantor_name) <= 80);
ALTER TABLE riders ADD CONSTRAINT riders_review_note_length CHECK (review_note IS NULL OR length(review_note) <= 500);
-- One pool rider per phone number.
CREATE UNIQUE INDEX riders_pool_phone_hash_key ON riders (phone_hash) WHERE business_id IS NULL;
ALTER TABLE businesses ADD CONSTRAINT businesses_rider_mode CHECK (rider_mode IN ('townmart', 'own'));
ALTER TABLE seller_orders ADD CONSTRAINT seller_orders_rider_pay CHECK (rider_pay_kobo IS NULL OR (rider_pay_kobo >= 0 AND rider_id IS NOT NULL));

-- Shops pick their default.
GRANT UPDATE (rider_mode) ON businesses TO townmart_app;
-- Shops open a delivery to the pool (or close it by using their own rider).
GRANT UPDATE (rider_pool_opened_at, rider_pay_kobo) ON seller_orders TO townmart_app;

-- The rider on an order is the shop's own rider, or an approved TownMart pool
-- rider put there by TownMart code (system or admin scope). A shop can take a
-- pool rider off (to use its own) but not put one on. A pool rider's pay is
-- set only by TownMart, and goes when the pool rider does.
-- SECURITY DEFINER: the shop can't read pool riders under its own RLS scope.
CREATE OR REPLACE FUNCTION guard_seller_order_rider() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r_business uuid;
  r_status text;
BEGIN
  IF NEW.rider_id IS NOT NULL AND NEW.rider_id IS DISTINCT FROM OLD.rider_id THEN
    SELECT business_id, status INTO r_business, r_status FROM riders WHERE id = NEW.rider_id;
    IF r_business IS NOT NULL THEN
      IF r_business <> NEW.business_id THEN
        RAISE EXCEPTION 'the rider must belong to the same shop' USING ERRCODE = 'check_violation';
      END IF;
    ELSE
      IF NOT app_is_privileged() THEN
        RAISE EXCEPTION 'only TownMart can put a pool rider on an order' USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF r_status IS DISTINCT FROM 'approved' THEN
        RAISE EXCEPTION 'the pool rider is not approved' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  IF NOT app_is_privileged() AND NEW.rider_pay_kobo IS NOT NULL AND NEW.rider_pay_kobo IS DISTINCT FROM OLD.rider_pay_kobo THEN
    RAISE EXCEPTION 'rider pay is set by TownMart' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.rider_id IS DISTINCT FROM OLD.rider_id AND NOT app_is_privileged() THEN
    NEW.rider_pay_kobo := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_seller_order_rider() FROM PUBLIC;
CREATE TRIGGER trg_seller_orders_rider BEFORE UPDATE OF rider_id, rider_pay_kobo ON seller_orders
  FOR EACH ROW EXECUTE FUNCTION guard_seller_order_rider();

-- Vetting is TownMart's: a rider can't approve themselves.
CREATE OR REPLACE FUNCTION guard_rider_status() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF app_is_privileged() THEN
    RETURN NEW;
  END IF;
  IF NEW.business_id IS NULL AND (
       (TG_OP = 'INSERT' AND NEW.status <> 'pending')
       OR (TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
                                 OR NEW.reviewed_by_user_id IS DISTINCT FROM OLD.reviewed_by_user_id OR NEW.user_id IS DISTINCT FROM OLD.user_id))) THEN
    RAISE EXCEPTION 'pool rider vetting is done by TownMart' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_riders_guard_status BEFORE INSERT OR UPDATE ON riders
  FOR EACH ROW EXECUTE FUNCTION guard_rider_status();

-- ── Row-level security ───────────────────────────────────────────────────────
-- A pool rider reads and updates their own row (online switch, location).
CREATE POLICY riders_pool_self ON riders FOR ALL
  USING (business_id IS NULL AND user_id = app_current_user_id())
  WITH CHECK (business_id IS NULL AND user_id = app_current_user_id());
-- A shop sees the pool rider bringing its order (name, number, last position).
CREATE POLICY riders_shop_read_pool ON riders FOR SELECT USING (
  business_id IS NULL AND EXISTS (SELECT 1 FROM seller_orders so
    WHERE so.rider_id = riders.id AND so.business_id = app_current_business_id()));
