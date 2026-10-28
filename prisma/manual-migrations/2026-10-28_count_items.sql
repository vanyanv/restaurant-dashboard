-- Weekly count + waste log (2026-10-28). Additive only: a new table, one
-- nullable column and three enum values. Nothing existing is changed.

-- Waste reasons from the phone waste log. "Went bad" reuses EXPIRY.
ALTER TYPE "InventoryAdjustmentReason" ADD VALUE IF NOT EXISTS 'DROPPED';
ALTER TYPE "InventoryAdjustmentReason" ADD VALUE IF NOT EXISTS 'BURNT';
ALTER TYPE "InventoryAdjustmentReason" ADD VALUE IF NOT EXISTS 'REMAKE';

-- How each shelf was counted, layer by layer, so a reopened item shows the
-- numbers that were typed.
ALTER TABLE "StockCountLine" ADD COLUMN IF NOT EXISTS "breakdown" JSONB;

-- One stop on the count walk: an ingredient, its area and its count layers.
CREATE TABLE IF NOT EXISTS "CountItem" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "canonicalIngredientId" TEXT NOT NULL,
  "area" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "layers" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CountItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CountItem_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CountItem_canonicalIngredientId_fkey" FOREIGN KEY ("canonicalIngredientId") REFERENCES "CanonicalIngredient"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "CountItem_accountId_canonicalIngredientId_area_key" ON "CountItem"("accountId", "canonicalIngredientId", "area");
CREATE INDEX IF NOT EXISTS "CountItem_accountId_active_idx" ON "CountItem"("accountId", "active");
