-- Phase 4: IngredientModelState — per-(store, ingredient) Bayesian
-- calibration state. Updated on every completed StockCount.

DO $$ BEGIN
  CREATE TYPE "IngredientConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERIFIED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "IngredientModelState" (
  "id"                       TEXT PRIMARY KEY,
  "storeId"                  TEXT NOT NULL,
  "canonicalIngredientId"    TEXT NOT NULL,
  "calibrationFactor"        DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "recountDeltaMean"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "recountDeltaM2"           DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sampleSize"               INTEGER NOT NULL DEFAULT 0,
  "consecutiveTightWeeks"    INTEGER NOT NULL DEFAULT 0,
  "isGraduated"              BOOLEAN NOT NULL DEFAULT false,
  "graduatedAt"              TIMESTAMP(3),
  "lastSpotCheckAt"          TIMESTAMP(3),
  "confidenceLevel"          "IngredientConfidenceLevel" NOT NULL DEFAULT 'LOW',
  "typicalWeeklyThroughput"  DOUBLE PRECISION,
  "lastUpdatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "IngredientModelState_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE,
  CONSTRAINT "IngredientModelState_canonicalIngredientId_fkey"
    FOREIGN KEY ("canonicalIngredientId") REFERENCES "CanonicalIngredient"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "IngredientModelState_storeId_canonicalIngredientId_key"
  ON "IngredientModelState" ("storeId", "canonicalIngredientId");

CREATE INDEX IF NOT EXISTS "IngredientModelState_storeId_isGraduated_idx"
  ON "IngredientModelState" ("storeId", "isGraduated");
