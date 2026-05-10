-- Harri-enhanced busy-hours ML forecast storage.
-- The nightly Python pipeline writes rows here; dashboard request paths only
-- read latest generated forecasts.

ALTER TYPE "MlTarget" ADD VALUE IF NOT EXISTS 'BUSY_HOURS';

CREATE TABLE IF NOT EXISTS "ForecastHourlyOrders" (
  "id"              TEXT PRIMARY KEY,
  "storeId"         TEXT NOT NULL,
  "forecastDate"    DATE NOT NULL,
  "hourBucket"      INTEGER NOT NULL,
  "predictedOrders" DOUBLE PRECISION NOT NULL,
  "p10"             DOUBLE PRECISION,
  "p90"             DOUBLE PRECISION,
  "modelVersion"    TEXT NOT NULL,
  "generatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualOrders"    DOUBLE PRECISION,
  "errorPct"        DOUBLE PRECISION,
  "reconciledAt"    TIMESTAMP(3),

  CONSTRAINT "ForecastHourlyOrders_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ForecastHourlyOrders_unique"
  ON "ForecastHourlyOrders" ("storeId", "forecastDate", "hourBucket", "generatedAt");

CREATE INDEX IF NOT EXISTS "ForecastHourlyOrders_storeId_forecastDate_idx"
  ON "ForecastHourlyOrders" ("storeId", "forecastDate");

CREATE INDEX IF NOT EXISTS "ForecastHourlyOrders_store_date_hour_generated_idx"
  ON "ForecastHourlyOrders" ("storeId", "forecastDate", "hourBucket", "generatedAt" DESC);

CREATE INDEX IF NOT EXISTS "ForecastHourlyOrders_generatedAt_idx"
  ON "ForecastHourlyOrders" ("generatedAt" DESC);

CREATE INDEX IF NOT EXISTS "HarriDailyLabor_storeId_date_idx"
  ON "HarriDailyLabor" ("storeId", "date");

CREATE INDEX IF NOT EXISTS "HarriPositionDaily_storeId_date_idx"
  ON "HarriPositionDaily" ("storeId", "date");

CREATE INDEX IF NOT EXISTS "HarriTimekeepingAlert_storeId_date_idx"
  ON "HarriTimekeepingAlert" ("storeId", "date");
