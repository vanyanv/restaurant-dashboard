-- Phase 1 W6: hierarchical reconciliation columns + two new tables.
-- See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §2
-- and reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

ALTER TABLE "ForecastDailyRevenue"
  ADD COLUMN IF NOT EXISTS "reconciledRevenue"    DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciledP10"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciledP90"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciliationMethod" TEXT;

ALTER TABLE "ForecastMenuItem"
  ADD COLUMN IF NOT EXISTS "reconciledQty"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reconciliationMethod" TEXT;

CREATE TABLE IF NOT EXISTS "ForecastDailyCategory" (
  "id"                    TEXT PRIMARY KEY,
  "storeId"               TEXT NOT NULL,
  "date"                  DATE NOT NULL,
  "categoryName"          TEXT NOT NULL,
  "revenue"               DOUBLE PRECISION NOT NULL,
  "reconciledRevenue"     DOUBLE PRECISION,
  "reconciledAt"          TIMESTAMP(3),
  "reconciliationMethod"  TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ForecastDailyCategory_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ForecastDailyCategory_storeId_date_categoryName_key"
  ON "ForecastDailyCategory" ("storeId", "date", "categoryName");
CREATE INDEX IF NOT EXISTS "ForecastDailyCategory_storeId_date_idx"
  ON "ForecastDailyCategory" ("storeId", "date");

CREATE TABLE IF NOT EXISTS "MlReconciliationDaily" (
  "id"                          TEXT PRIMARY KEY,
  "storeId"                     TEXT NOT NULL,
  "date"                        DATE NOT NULL,
  "prePctDiscrepancyMedian"     DOUBLE PRECISION,
  "prePctDiscrepancyP95"        DOUBLE PRECISION,
  "postPctDiscrepancyMedian"    DOUBLE PRECISION,
  "postPctDiscrepancyP95"       DOUBLE PRECISION,
  "methodUsed"                  TEXT NOT NULL,
  "sampleSize"                  INTEGER NOT NULL DEFAULT 0,
  "createdAt"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MlReconciliationDaily_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "MlReconciliationDaily_storeId_date_key"
  ON "MlReconciliationDaily" ("storeId", "date");
CREATE INDEX IF NOT EXISTS "MlReconciliationDaily_storeId_date_idx"
  ON "MlReconciliationDaily" ("storeId", "date" DESC);
