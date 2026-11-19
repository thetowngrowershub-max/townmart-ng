-- Delivery priced by distance (shop and customer locations), and each shop's own riders.
-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "seller_orders" ADD COLUMN     "delivery_distance_m" INTEGER,
ADD COLUMN     "picked_up_at" TIMESTAMPTZ(6),
ADD COLUMN     "rider_assigned_at" TIMESTAMPTZ(6),
ADD COLUMN     "rider_id" UUID;

-- CreateTable
CREATE TABLE "riders" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "business_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_hash" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT 'motorbike',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_available" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location_updated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "riders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "riders_business_id_is_active_is_available_idx" ON "riders"("business_id", "is_active", "is_available");

-- CreateIndex
CREATE UNIQUE INDEX "riders_business_id_phone_hash_key" ON "riders"("business_id", "phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "riders_id_business_key" ON "riders"("id", "business_id");

-- CreateIndex
CREATE INDEX "seller_orders_rider_id_business_id_idx" ON "seller_orders"("rider_id", "business_id");

-- AddForeignKey
ALTER TABLE "seller_orders" ADD CONSTRAINT "seller_orders_rider_same_business" FOREIGN KEY ("rider_id", "business_id") REFERENCES "riders"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


SELECT attach_updated_at_trigger('public.riders'::regclass);

-- ── Rules the app relies on ──────────────────────────────────────────────────
ALTER TABLE addresses ADD CONSTRAINT addresses_location CHECK (
  (latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)));
ALTER TABLE businesses ADD CONSTRAINT businesses_location CHECK (
  (latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)));
ALTER TABLE riders ADD CONSTRAINT riders_location CHECK (
  (latitude IS NULL) = (longitude IS NULL) AND (latitude IS NULL OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)));
ALTER TABLE riders ADD CONSTRAINT riders_name_required CHECK (length(btrim(name)) BETWEEN 2 AND 80);
ALTER TABLE riders ADD CONSTRAINT riders_vehicle CHECK (vehicle IN ('motorbike', 'bicycle', 'tricycle', 'car', 'on_foot'));
ALTER TABLE seller_orders ADD CONSTRAINT seller_orders_delivery_distance CHECK (delivery_distance_m IS NULL OR delivery_distance_m >= 0);
ALTER TABLE seller_orders ADD CONSTRAINT seller_orders_rider_assigned CHECK ((rider_id IS NULL) = (rider_assigned_at IS NULL));

-- Sellers assign riders, and the rider page records the pickup.
GRANT UPDATE (rider_id, rider_assigned_at, picked_up_at) ON seller_orders TO townmart_app;

-- ── Row-level security ───────────────────────────────────────────────────────
-- A shop's riders are its own business: only the shop and TownMart see them.
ALTER TABLE riders ENABLE ROW LEVEL SECURITY;
CREATE POLICY riders_rw ON riders FOR ALL
  USING (business_id = app_current_business_id() OR app_is_privileged())
  WITH CHECK (business_id = app_current_business_id() OR app_is_privileged());
