-- Phase 1 W9: GrowthOpportunity persistence.
-- See docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md §3.1
-- and reference_prisma_migrations memory: db push + manual SQL, never migrate dev.

DO $$ BEGIN
  CREATE TYPE "OpportunityType" AS ENUM (
    'reprice', 'menu_engineering', 'channel_mix', 'food_cost_risk', 'profit_risk'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OpportunityConfidence" AS ENUM ('low', 'medium', 'high');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GrowthOpportunity" (
  "id"                     TEXT PRIMARY KEY,
  "storeId"                TEXT NOT NULL,
  "asOfDate"               DATE NOT NULL,
  "opportunityType"        "OpportunityType" NOT NULL,
  "title"                  TEXT NOT NULL,
  "estimatedDollarImpact"  DOUBLE PRECISION NOT NULL,
  "confidence"             "OpportunityConfidence" NOT NULL,
  "evidence"               JSONB NOT NULL DEFAULT '[]'::jsonb,
  "caveats"                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "suggestedAction"        TEXT NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrowthOpportunity_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Upsert key for the nightly writer (idempotent re-runs on the same day).
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthOpportunity_storeId_asOfDate_type_title_key"
  ON "GrowthOpportunity" ("storeId", "asOfDate", "opportunityType", "title");

CREATE INDEX IF NOT EXISTS "GrowthOpportunity_storeId_asOfDate_idx"
  ON "GrowthOpportunity" ("storeId", "asOfDate" DESC);
