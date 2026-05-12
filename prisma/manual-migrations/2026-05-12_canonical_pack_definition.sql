-- 2026-05-12 — three-tier stock count pack definition
--
-- Adds four nullable columns to `CanonicalIngredient` so each canonical can
-- carry the case + inner-pack structure used by the mobile count flow:
--
--   caseUnit            "CS", "BX" — display label for tier 1
--   innerPackUnit       "PK", "LOAF" — display label for tier 2 (NULL hides it)
--   recipeUnitsPerCase  Float — canonical units in one full case
--   innerPacksPerCase   Float — inner packs in one case (paired with innerPackUnit)
--
-- Applied via `prisma db push`; this file is the canonical audit trail.

ALTER TABLE "CanonicalIngredient"
  ADD COLUMN IF NOT EXISTS "caseUnit"           TEXT,
  ADD COLUMN IF NOT EXISTS "innerPackUnit"      TEXT,
  ADD COLUMN IF NOT EXISTS "recipeUnitsPerCase" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "innerPacksPerCase"  DOUBLE PRECISION;
