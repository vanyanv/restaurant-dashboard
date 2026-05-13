-- Phase 1 Feature 1.1: persisted forecast-quality table.
--
-- Written nightly by `ml/evaluation/evaluator.py` after reconciliation. The
-- dashboard reads it via `src/app/actions/forecasts/quality-actions.ts` and
-- the chat tool `getForecastQuality`. One row per
-- (target, store, modelVersion, horizonDay, window).

CREATE TABLE IF NOT EXISTS "MlForecastEvaluation" (
  "id"                  TEXT PRIMARY KEY,
  "target"              "MlTarget" NOT NULL,
  "storeId"             TEXT NOT NULL,
  "modelVersion"        TEXT NOT NULL,
  "horizonDay"          INTEGER NOT NULL DEFAULT 0,
  "windowStart"         DATE NOT NULL,
  "windowEnd"           DATE NOT NULL,
  "wape"                DOUBLE PRECISION,
  "mape"                DOUBLE PRECISION,
  "mae"                 DOUBLE PRECISION,
  "bias"                DOUBLE PRECISION,
  "intervalCoverage80"  DOUBLE PRECISION,
  "intervalCoverage95"  DOUBLE PRECISION,
  "baselineWape"        DOUBLE PRECISION,
  "enrichedWape"        DOUBLE PRECISION,
  "staleRowCount"       INTEGER NOT NULL DEFAULT 0,
  "sampleSize"          INTEGER NOT NULL DEFAULT 0,
  "computedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MlForecastEvaluation_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "MlForecastEvaluation_target_storeId_modelVersion_horizonDay_key"
  ON "MlForecastEvaluation" ("target", "storeId", "modelVersion", "horizonDay", "windowStart", "windowEnd");

CREATE INDEX IF NOT EXISTS "MlForecastEvaluation_storeId_target_computedAt_idx"
  ON "MlForecastEvaluation" ("storeId", "target", "computedAt" DESC);

CREATE INDEX IF NOT EXISTS "MlForecastEvaluation_computedAt_idx"
  ON "MlForecastEvaluation" ("computedAt" DESC);
