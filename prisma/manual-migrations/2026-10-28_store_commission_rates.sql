-- Store commission rates as owner-edited settings, one per platform and
-- fulfilment mode. Every rate is charged on the price AFTER discounts
-- (OtterOrder.subtotal + OtterOrder.discount) and only for an order that
-- arrived without a recorded fee; a recorded fee always wins.
--
-- "uberCommissionRate" and "doordashCommissionRate" keep their names and are
-- the DELIVERY rates. Three new columns carry the pickup rates and Grubhub.
--
-- Additive, then a data update for the existing stores (Hollywood, Glendale,
-- Van Nuys): the owner's figures, close to what the recorded orders show over
-- the 30 days to 2026-10-28 (DoorDash delivery 25.3%, pickup 6.1%; Uber Eats
-- delivery 26.8%, pickup 9.7%; Grubhub 25%).
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "uberPickupCommissionRate" DOUBLE PRECISION DEFAULT 0.10;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "doordashPickupCommissionRate" DOUBLE PRECISION DEFAULT 0.06;
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "grubhubCommissionRate" DOUBLE PRECISION DEFAULT 0.25;
ALTER TABLE "Store" ALTER COLUMN "uberCommissionRate" SET DEFAULT 0.27;

-- Scoped to the one account in production, acc_default_chrisneddys (verified
-- 2026-10-28: every "Store" row belongs to it). The WHERE keeps the owner's
-- figures from landing on any other tenant's stores if one exists by the
-- time this runs.
UPDATE "Store" SET
  "doordashCommissionRate"       = 0.25,
  "doordashPickupCommissionRate" = 0.06,
  "uberCommissionRate"           = 0.27,
  "uberPickupCommissionRate"     = 0.10,
  "grubhubCommissionRate"        = 0.25
WHERE "accountId" = 'acc_default_chrisneddys';
