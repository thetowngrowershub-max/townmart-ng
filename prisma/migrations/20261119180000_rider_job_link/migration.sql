-- The shop's rider joins the order conversation from their job link.
-- AlterEnum
ALTER TYPE "message_sender" ADD VALUE 'rider';

-- AlterTable
ALTER TABLE "messages" ADD COLUMN "sender_name" TEXT;

ALTER TABLE messages ADD CONSTRAINT messages_sender_name_length CHECK (sender_name IS NULL OR length(sender_name) <= 80);

-- Rider messages are written by TownMart code after it checks the job link
-- (system scope), so the insert policy needs no new branch.

-- A shopper sees the name and number of the rider bringing their order
-- (signed-in shoppers read their orders under their own RLS scope).
CREATE POLICY riders_customer_read ON riders FOR SELECT USING (
  EXISTS (SELECT 1 FROM seller_orders so JOIN orders o ON o.id = so.order_id
          WHERE so.rider_id = riders.id AND o.user_id = app_current_user_id()));
