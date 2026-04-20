-- Migration: CanonicalIngredient cost fields
-- Date: 2026-04-19
--
-- Summary:
--   Adds five nullable / defaulted fields to CanonicalIngredient so each
--   canonical owns a "recipe unit + cost per unit" used directly by the
--   recipe costing walker:
--     - recipeUnit        (string, nullable)   "lb" | "oz" | "each" | etc.
--     - costPerRecipeUnit (float,  nullable)
--     - costSource        (string, nullable)   "manual" | "invoice"
--     - costLocked        (bool,   default false)
--     - costUpdatedAt     (timestamp, nullable)
--
--   All additive, no backfill needed. Existing rows start with nulls and a
--   locked=false default; users populate them via the catalog UI or via
--   Phase 2 invoice-derived recomputes.
--
-- Note: `npx prisma db push` has already applied these changes to the dev DB.
-- This file documents the change for parity with other manual migrations.

BEGIN;

ALTER TABLE "CanonicalIngredient"
  ADD COLUMN IF NOT EXISTS "recipeUnit"        TEXT,
  ADD COLUMN IF NOT EXISTS "costPerRecipeUnit" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "costSource"        TEXT,
  ADD COLUMN IF NOT EXISTS "costLocked"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "costUpdatedAt"     TIMESTAMP(3);

COMMIT;
