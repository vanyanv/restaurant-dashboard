-- Phase 5: ML forecasting storage layer.
--
-- Forecasts are produced by a nightly Python pipeline (ml/run_nightly.py)
-- running on GitHub Actions. The dashboard ONLY reads from these tables.
-- Never train inside Vercel.

DO $$ BEGIN
  CREATE TYPE "MlTrainingStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "MlTarget" AS ENUM ('REVENUE', 'MENU_ITEM', 'INVENTORY');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnomalyMethod" AS ENUM ('ZSCORE', 'ISOLATION_FOREST');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnomalyTarget" AS ENUM ('REVENUE', 'MENU_ITEM', 'INGREDIENT', 'LABOR', 'REFUNDS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AnomalyStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'EXPLAINED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "MlTrainingRun" (
  "id"            TEXT PRIMARY KEY,
  "startedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"   TIMESTAMP(3),
  "modelType"     TEXT NOT NULL,
  "target"        "MlTarget" NOT NULL,
  "scope"         TEXT,
  "mape"          DOUBLE PRECISION,
  "mae"           DOUBLE PRECISION,
  "sampleSize"    INTEGER,
  "modelVersion"  TEXT,
  "artifactPath"  TEXT,
  "status"        "MlTrainingStatus" NOT NULL DEFAULT 'RUNNING',
  "errorMessage"  TEXT
);

CREATE INDEX IF NOT EXISTS "MlTrainingRun_target_startedAt_idx"
  ON "MlTrainingRun" ("target", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "MlTrainingRun_status_startedAt_idx"
  ON "MlTrainingRun" ("status", "startedAt" DESC);

CREATE TABLE IF NOT EXISTS "ForecastDailyRevenue" (
  "id"               TEXT PRIMARY KEY,
  "storeId"          TEXT NOT NULL,
  "forecastDate"     DATE NOT NULL,
  "hourBucket"       INTEGER NOT NULL DEFAULT 0,
  "predictedRevenue" DOUBLE PRECISION NOT NULL,
  "p10"              DOUBLE PRECISION,
  "p90"              DOUBLE PRECISION,
  "modelVersion"     TEXT NOT NULL,
  "generatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualRevenue"    DOUBLE PRECISION,
  "errorPct"         DOUBLE PRECISION,
  "reconciledAt"     TIMESTAMP(3),

  CONSTRAINT "ForecastDailyRevenue_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ForecastDailyRevenue_unique"
  ON "ForecastDailyRevenue" ("storeId", "forecastDate", "hourBucket", "generatedAt");
CREATE INDEX IF NOT EXISTS "ForecastDailyRevenue_storeId_forecastDate_idx"
  ON "ForecastDailyRevenue" ("storeId", "forecastDate");
CREATE INDEX IF NOT EXISTS "ForecastDailyRevenue_generatedAt_idx"
  ON "ForecastDailyRevenue" ("generatedAt" DESC);

CREATE TABLE IF NOT EXISTS "ForecastMenuItem" (
  "id"             TEXT PRIMARY KEY,
  "storeId"        TEXT NOT NULL,
  "otterItemSkuId" TEXT NOT NULL,
  "forecastDate"   DATE NOT NULL,
  "predictedQty"   DOUBLE PRECISION NOT NULL,
  "p10"            DOUBLE PRECISION,
  "p90"            DOUBLE PRECISION,
  "modelVersion"   TEXT NOT NULL,
  "generatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actualQty"      DOUBLE PRECISION,
  "errorPct"       DOUBLE PRECISION,
  "reconciledAt"   TIMESTAMP(3),

  CONSTRAINT "ForecastMenuItem_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ForecastMenuItem_unique"
  ON "ForecastMenuItem" ("storeId", "otterItemSkuId", "forecastDate", "generatedAt");
CREATE INDEX IF NOT EXISTS "ForecastMenuItem_storeId_forecastDate_idx"
  ON "ForecastMenuItem" ("storeId", "forecastDate");
CREATE INDEX IF NOT EXISTS "ForecastMenuItem_generatedAt_idx"
  ON "ForecastMenuItem" ("generatedAt" DESC);

CREATE TABLE IF NOT EXISTS "AnomalyEvent" (
  "id"             TEXT PRIMARY KEY,
  "storeId"        TEXT NOT NULL,
  "target"         "AnomalyTarget" NOT NULL,
  "targetId"       TEXT,
  "occurredOn"     DATE NOT NULL,
  "residual"       DOUBLE PRECISION NOT NULL,
  "zScore"         DOUBLE PRECISION,
  "method"         "AnomalyMethod" NOT NULL,
  "status"         "AnomalyStatus" NOT NULL DEFAULT 'OPEN',
  "explanation"    TEXT,
  "detectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),

  CONSTRAINT "AnomalyEvent_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "AnomalyEvent_storeId_occurredOn_idx"
  ON "AnomalyEvent" ("storeId", "occurredOn" DESC);
CREATE INDEX IF NOT EXISTS "AnomalyEvent_status_detectedAt_idx"
  ON "AnomalyEvent" ("status", "detectedAt" DESC);
