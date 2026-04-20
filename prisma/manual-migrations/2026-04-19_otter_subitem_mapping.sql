-- Migration: OtterSubItemMapping table
-- Date: 2026-04-19
--
-- Summary:
--   Adds per-store mapping from Otter order sub-item (modifier) SKUs to a
--   Recipe. Multiple distinct sub-item SKUs ("Add Pickle" vs "Add Pickles",
--   different Otter platform SKUs for the same physical modifier) can point
--   at one modifier recipe. The cogs materializer uses this to add per-day
--   modifier cost on top of each mapped menu-item's base cost.
--
--   Identity is (storeId, skuId). Every OtterOrderSubItem has a skuId, so we
--   don't fall back to name-based matching — it would collide across
--   platforms.
--
-- Note: `npx prisma db push` has already applied these changes to the dev DB.
-- This file documents the change for parity with other manual migrations.

BEGIN;

CREATE TABLE IF NOT EXISTS "OtterSubItemMapping" (
  "id"                TEXT NOT NULL,
  "storeId"           TEXT NOT NULL,
  "skuId"             TEXT NOT NULL,
  "otterSubItemName"  TEXT NOT NULL,
  "recipeId"          TEXT NOT NULL,
  "confirmedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtterSubItemMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtterSubItemMapping_storeId_skuId_key"
  ON "OtterSubItemMapping"("storeId", "skuId");
CREATE INDEX IF NOT EXISTS "OtterSubItemMapping_storeId_idx"
  ON "OtterSubItemMapping"("storeId");
CREATE INDEX IF NOT EXISTS "OtterSubItemMapping_recipeId_idx"
  ON "OtterSubItemMapping"("recipeId");

ALTER TABLE "OtterSubItemMapping"
  ADD CONSTRAINT "OtterSubItemMapping_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OtterSubItemMapping"
  ADD CONSTRAINT "OtterSubItemMapping_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
