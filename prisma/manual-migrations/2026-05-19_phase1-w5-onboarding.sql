-- Phase 1 Week 5: Store-lifecycle onboarding + transfer-forecast source.
-- Adds:
--   * Store.lifecycleStage (enum LifecycleStage)
--   * Store.initialTransferScalar (Float)
--   * Store.openedAt (DateTime)
--   * Forecast{DailyRevenue,MenuItem,HourlyOrders}.forecastSource (enum ForecastSource)
--
-- See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §1
-- and reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

DO $$ BEGIN
  CREATE TYPE "LifecycleStage" AS ENUM ('pre_open', 'warming_up', 'ready');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ForecastSource" AS ENUM ('native', 'transfer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "lifecycleStage" "LifecycleStage" NOT NULL DEFAULT 'pre_open',
  ADD COLUMN IF NOT EXISTS "initialTransferScalar" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "openedAt" TIMESTAMP(3);

-- Hollywood is operational today; mark it ready so nothing changes for it.
-- Match by suffix because the production name is "Chris N Eddys - Hollywood".
UPDATE "Store"
   SET "lifecycleStage" = 'ready',
       "openedAt" = COALESCE("openedAt", "createdAt")
 WHERE "name" ILIKE '%Hollywood' AND "isActive" = true;

ALTER TABLE "ForecastDailyRevenue"
  ADD COLUMN IF NOT EXISTS "forecastSource" "ForecastSource" NOT NULL DEFAULT 'native';
ALTER TABLE "ForecastMenuItem"
  ADD COLUMN IF NOT EXISTS "forecastSource" "ForecastSource" NOT NULL DEFAULT 'native';
ALTER TABLE "ForecastHourlyOrders"
  ADD COLUMN IF NOT EXISTS "forecastSource" "ForecastSource" NOT NULL DEFAULT 'native';

CREATE INDEX IF NOT EXISTS "ForecastDailyRevenue_storeId_forecastSource_idx"
  ON "ForecastDailyRevenue" ("storeId", "forecastSource");
CREATE INDEX IF NOT EXISTS "ForecastMenuItem_storeId_forecastSource_idx"
  ON "ForecastMenuItem" ("storeId", "forecastSource");
CREATE INDEX IF NOT EXISTS "ForecastHourlyOrders_storeId_forecastSource_idx"
  ON "ForecastHourlyOrders" ("storeId", "forecastSource");
