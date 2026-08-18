-- IngredientSkuMatch: move the learned-match identity off the raw vendor
-- spelling and onto a normalized vendorKey.
--
-- Why: the table was unique on (accountId, vendorName, sku) where vendorName
-- is the *display* normalization, which lets unknown vendors through with
-- their raw casing. Vitco writes "VITCO FOODSERVICE" on some invoice
-- templates and "Vitco Foodservice" on others, so SKU 15725 ended up with two
-- contradictory mappings — the 180x1.5oz sauce cup under one spelling, the
-- 4x4LB bulk tub under the other. $15,119.52 of cup purchases were booked
-- against the bulk ingredient, and 5 caps-spelled 15726 lines ($2,971.70)
-- never matched at all because no caps-spelled row existed for that SKU.
--
-- IMPORTANT — ordering. Run scripts/fix-vendor-sku-collisions.ts --apply
-- FIRST. It adds the column, backfills it, and collapses the rows that would
-- violate the new unique indexes. Creating the indexes on un-deduplicated
-- data fails.
--
-- Do NOT apply this with `prisma db push`: as of 2026-08-18 the live schema
-- also drifts on three intentionally-retained tables (AiForecastRun,
-- InvoiceSyncLog, VercelUsageSnapshot) and the Store.yelp* columns, and a
-- push would drop all of them.

ALTER TABLE "IngredientSkuMatch"
  ADD COLUMN IF NOT EXISTS "vendorKey" TEXT NOT NULL DEFAULT '';

-- vendorKey values are written by the repair script: vendorMatchKey() lives in
-- TypeScript (it consults the VENDOR_ALIASES table) and has no SQL equivalent.

-- These exist as unique CONSTRAINTS on some environments and as bare unique
-- INDEXES on others (db push has produced both over this table's life), and
-- DROP INDEX refuses to touch an index a constraint owns. Drop both ways.
ALTER TABLE "IngredientSkuMatch"
  DROP CONSTRAINT IF EXISTS "IngredientSkuMatch_ownerId_vendorName_sku_key";
ALTER TABLE "IngredientSkuMatch"
  DROP CONSTRAINT IF EXISTS "IngredientSkuMatch_accountId_vendorName_sku_key";
DROP INDEX IF EXISTS "IngredientSkuMatch_ownerId_vendorName_sku_key";
DROP INDEX IF EXISTS "IngredientSkuMatch_accountId_vendorName_sku_key";

CREATE UNIQUE INDEX IF NOT EXISTS "IngredientSkuMatch_ownerId_vendorKey_sku_key"
  ON "IngredientSkuMatch" ("ownerId", "vendorKey", "sku");
CREATE UNIQUE INDEX IF NOT EXISTS "IngredientSkuMatch_accountId_vendorKey_sku_key"
  ON "IngredientSkuMatch" ("accountId", "vendorKey", "sku");
