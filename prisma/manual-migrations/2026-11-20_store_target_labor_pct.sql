-- A labor target per store, as an owner-edited setting on the store file.
--
-- A percent of sales (28 means 28%), the same units as "targetCogsPct". The
-- Labor page grades each day and each store against it, and Overview and the
-- P&L draw their labor figure against it (src/lib/counter/targets.ts).
--
-- Additive and nullable, with no default: a store with no target is graded
-- against nothing, and no store gets a target the owner did not type.
-- Apply BEFORE deploying the code that selects the column.
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "targetLaborPct" DOUBLE PRECISION;
