-- Wallets for TownMart pool riders, and payouts that wait for TownMart's approval.
-- New enum values go in their own migration: Postgres can't use a value in the transaction that adds it.
ALTER TYPE "ledger_owner_type" ADD VALUE IF NOT EXISTS 'rider';
ALTER TYPE "payout_status" ADD VALUE IF NOT EXISTS 'awaiting_approval' BEFORE 'pending';
ALTER TYPE "payout_status" ADD VALUE IF NOT EXISTS 'rejected';
