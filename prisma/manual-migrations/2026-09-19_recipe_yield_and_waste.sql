-- 2026-09-19 — Batch yield unit, and per-ingredient usable yield.
--
-- Context: `Recipe.servingSize` has existed since the first recipes migration
-- and was never divided out of a recipe's cost. Every row in the live database
-- reads 1, so the figure has been right by accident. Two columns make it
-- mean something, and both default to the value that keeps every existing
-- figure exactly where it is:
--
--   Recipe.yieldUnit               NULL  → the recipe yields portions, as today
--   CanonicalIngredient.yieldFactor 1    → no trim or cooking loss, as today
--
-- Nothing here rewrites a cost. Run AFTER `npm run db:drift` reports
-- "No difference detected", then `prisma db push`. Never `prisma migrate dev`
-- — it would reset the Neon production database.

ALTER TABLE "Recipe"
  ADD COLUMN IF NOT EXISTS "yieldUnit" TEXT;

ALTER TABLE "CanonicalIngredient"
  ADD COLUMN IF NOT EXISTS "yieldFactor" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- A yield factor outside (0, 1] is not a waste percentage, it is a typo or a
-- units mix-up, and either one multiplies a plate cost without saying so.
-- Same shape as `recipe_serving_size_positive` (2026-05-02): add the
-- constraint only if nothing already violates it, and say so loudly if
-- something does, rather than failing the migration.
DO $$
DECLARE violating INT;
BEGIN
  SELECT COUNT(*) INTO violating
  FROM "CanonicalIngredient"
  WHERE "yieldFactor" <= 0 OR "yieldFactor" > 1;

  IF violating > 0 THEN
    RAISE NOTICE 'Skipping canonical_ingredient_yield_factor_range CHECK: % row(s) violate it. Fix them, then add the constraint manually.', violating;
  ELSE
    EXECUTE 'ALTER TABLE "CanonicalIngredient" DROP CONSTRAINT IF EXISTS "canonical_ingredient_yield_factor_range"';
    EXECUTE 'ALTER TABLE "CanonicalIngredient" ADD CONSTRAINT "canonical_ingredient_yield_factor_range" CHECK ("yieldFactor" > 0 AND "yieldFactor" <= 1)';
  END IF;
END $$;

-- A recipe line quantity of zero or less is not a recipe line. The server
-- action has always rejected these (`validateRecipeShape`); the one write path
-- that skipped that check — accepting an AI mapping proposal — no longer does.
-- This is the backstop, added the same conditional way.
DO $$
DECLARE violating INT;
BEGIN
  SELECT COUNT(*) INTO violating FROM "RecipeIngredient" WHERE "quantity" <= 0;

  IF violating > 0 THEN
    RAISE NOTICE 'Skipping recipe_ingredient_quantity_positive CHECK: % row(s) violate it. Fix them, then add the constraint manually.', violating;
  ELSE
    EXECUTE 'ALTER TABLE "RecipeIngredient" DROP CONSTRAINT IF EXISTS "recipe_ingredient_quantity_positive"';
    EXECUTE 'ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "recipe_ingredient_quantity_positive" CHECK ("quantity" > 0)';
  END IF;
END $$;
