-- Migration: DailyCogsItem materialized COGS table
-- Date: 2026-04-19
--
-- Summary:
--   1. Add CogsStatus enum (COSTED, UNMAPPED, MISSING_COST).
--   2. Create DailyCogsItem table — per (store, date, itemName) row with
--      pre-computed unit cost, line cost, qty sold, and recipe link.
--   3. Populated by src/lib/cogs-materializer.ts during Otter sync and via
--      manual recompute. Invalidated (rows deleted) by src/lib/cogs-invalidate.ts
--      on upstream mutations (invoice, recipe, mapping, alias, canonical).
--
-- Note: `npx prisma db push` has already applied these changes to the dev DB.
-- This file documents the change for parity with other manual migrations.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CogsStatus') THEN
    CREATE TYPE "CogsStatus" AS ENUM ('COSTED', 'UNMAPPED', 'MISSING_COST');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS "DailyCogsItem" (
  "id"           TEXT NOT NULL,
  "storeId"      TEXT NOT NULL,
  "date"         DATE NOT NULL,
  "itemName"     TEXT NOT NULL,
  "category"     TEXT NOT NULL,
  "recipeId"     TEXT,
  "qtySold"      DOUBLE PRECISION NOT NULL,
  "salesRevenue" DOUBLE PRECISION NOT NULL,
  "unitCost"     DOUBLE PRECISION,
  "lineCost"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status"       "CogsStatus" NOT NULL,
  "computedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DailyCogsItem_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyCogsItem_storeId_fkey'
  ) THEN
    ALTER TABLE "DailyCogsItem"
      ADD CONSTRAINT "DailyCogsItem_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'DailyCogsItem_recipeId_fkey'
  ) THEN
    ALTER TABLE "DailyCogsItem"
      ADD CONSTRAINT "DailyCogsItem_recipeId_fkey"
      FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE SET NULL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS "DailyCogsItem_storeId_date_itemName_category_key"
  ON "DailyCogsItem"("storeId", "date", "itemName", "category");
CREATE INDEX IF NOT EXISTS "DailyCogsItem_storeId_date_idx"
  ON "DailyCogsItem"("storeId", "date");
CREATE INDEX IF NOT EXISTS "DailyCogsItem_recipeId_date_idx"
  ON "DailyCogsItem"("recipeId", "date");

COMMIT;
