-- Payouts and bank accounts belong to a shop or to a TownMart pool rider (exactly one).
ALTER TABLE "payout_accounts" ALTER COLUMN "business_id" DROP NOT NULL,
ADD COLUMN "rider_id" UUID,
-- Which provider the recipient code was registered with (paystack, flutterwave, fake). NULL on accounts saved before this.
ADD COLUMN "recipient_provider" TEXT;

ALTER TABLE "payouts" ALTER COLUMN "business_id" DROP NOT NULL,
ADD COLUMN "rider_id" UUID,
ADD COLUMN "reviewed_by" UUID,
ADD COLUMN "reviewed_at" TIMESTAMPTZ(6);

CREATE UNIQUE INDEX "payout_accounts_rider_id_key" ON "payout_accounts"("rider_id");
CREATE INDEX "payouts_rider_id_created_at_idx" ON "payouts"("rider_id", "created_at");

ALTER TABLE "payout_accounts" ADD CONSTRAINT "payout_accounts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_rider_id_fkey" FOREIGN KEY ("rider_id") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE payout_accounts ADD CONSTRAINT payout_accounts_owner CHECK (num_nonnulls(business_id, rider_id) = 1);
ALTER TABLE payouts ADD CONSTRAINT payouts_owner CHECK (num_nonnulls(business_id, rider_id) = 1);

-- One payout on its way (or waiting for approval) per shop and per rider.
DROP INDEX IF EXISTS payouts_one_in_flight;
CREATE UNIQUE INDEX payouts_one_in_flight ON payouts (business_id) WHERE business_id IS NOT NULL AND status IN ('awaiting_approval', 'pending', 'processing');
CREATE UNIQUE INDEX payouts_rider_one_in_flight ON payouts (rider_id) WHERE rider_id IS NOT NULL AND status IN ('awaiting_approval', 'pending', 'processing');

-- Rider wallet accounts: keyed by the rider id, no business owner (so sellers' RLS never shows them).
ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_owner;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_owner CHECK (
  (owner_type = 'business' AND owner_id IS NOT NULL AND owner_key = owner_id::text)
  OR (owner_type = 'provider_clearing' AND owner_id IS NULL AND owner_key <> '')
  OR (owner_type = 'rider' AND owner_id IS NULL AND owner_key <> '')
  OR (owner_type IN ('platform', 'customer') AND owner_id IS NULL AND owner_key = ''));

-- Wallet history for a rider is read by account.
CREATE INDEX IF NOT EXISTS ledger_accounts_rider_idx ON ledger_accounts (owner_key) WHERE owner_type = 'rider';
