-- Owner-managed store-specific fixed expenses for the P&L.
-- Additive to the four hardcoded Store.fixedMonthly* fields; each row becomes an
-- FX_<id> line on the P&L (see src/lib/pnl.ts computeStorePnL).
-- reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

DO $$ BEGIN
  CREATE TYPE "ExpenseFrequency" AS ENUM ('WEEKLY', 'MONTHLY', 'YEARLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "StoreFixedExpense" (
  "id"        TEXT PRIMARY KEY,
  "storeId"   TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "amount"    DOUBLE PRECISION NOT NULL,
  "frequency" "ExpenseFrequency" NOT NULL DEFAULT 'MONTHLY',
  "glCode"    TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreFixedExpense_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "StoreFixedExpense_storeId_isActive_idx"
  ON "StoreFixedExpense" ("storeId", "isActive");
