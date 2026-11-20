-- Two-step sign-in with an authenticator app, a text message or an email code,
-- plus one-time backup codes.

-- AlterEnum
ALTER TYPE "otp_purpose" ADD VALUE 'two_factor_email';

-- CreateEnum
CREATE TYPE "two_factor_method" AS ENUM ('authenticator', 'sms', 'email');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "two_factor_method" "two_factor_method",
ADD COLUMN     "totp_secret_encrypted" TEXT,
ADD COLUMN     "totp_last_step" INTEGER,
ADD COLUMN     "two_factor_backup_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Accounts that already had two-step sign-in on used text messages.
UPDATE "users" SET "two_factor_method" = 'sms' WHERE "two_factor_enabled_at" IS NOT NULL;
