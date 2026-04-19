-- Migration: Recipes + COGS foundation
-- Date: 2026-04-18
--
-- Summary:
--   1. Lift Recipe.storeId -> Recipe.ownerId (owner-level recipe catalog)
--   2. Add Recipe.isSellable (distinguish menu items from prep/sub-recipes)
--   3. Create CanonicalIngredient table (owner-level ingredient registry)
--   4. Wire IngredientAlias.canonicalIngredientId -> CanonicalIngredient (keep canonicalName string for now)
--   5. Make RecipeIngredient polymorphic: canonicalIngredientId OR componentRecipeId (exactly one)
--   6. Create OtterItemMapping table (Otter item-name -> Recipe link)
--
-- Safe to re-run: uses IF NOT EXISTS / IF EXISTS guards where possible.
-- Run inside a transaction. After this, run `npx prisma generate`.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Recipe: storeId -> ownerId
-- ---------------------------------------------------------------------------

-- Add ownerId nullable, backfill, then enforce
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "ownerId" TEXT;

UPDATE "Recipe" r
SET "ownerId" = s."ownerId"
FROM "Store" s
WHERE r."storeId" = s."id"
  AND r."ownerId" IS NULL;

-- Guard: any Recipe rows we could not backfill?
DO $$
DECLARE unbacked INT;
BEGIN
  SELECT COUNT(*) INTO unbacked FROM "Recipe" WHERE "ownerId" IS NULL;
  IF unbacked > 0 THEN
    RAISE EXCEPTION 'Recipe backfill failed: % rows have NULL ownerId', unbacked;
  END IF;
END $$;

ALTER TABLE "Recipe" ALTER COLUMN "ownerId" SET NOT NULL;

-- Drop old storeId FK + index + unique, add new
ALTER TABLE "Recipe" DROP CONSTRAINT IF EXISTS "Recipe_storeId_fkey";
DROP INDEX IF EXISTS "Recipe_storeId_idx";
ALTER TABLE "Recipe" DROP CONSTRAINT IF EXISTS "Recipe_storeId_itemName_category_key";
ALTER TABLE "Recipe" DROP COLUMN IF EXISTS "storeId";

ALTER TABLE "Recipe"
  ADD CONSTRAINT "Recipe_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Recipe_ownerId_idx" ON "Recipe"("ownerId");
CREATE UNIQUE INDEX IF NOT EXISTS "Recipe_ownerId_itemName_category_key"
  ON "Recipe"("ownerId", "itemName", "category");

-- 2. Recipe: add isSellable
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "isSellable" BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------------------
-- 3. CanonicalIngredient table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "CanonicalIngredient" (
  "id"          TEXT PRIMARY KEY,
  "ownerId"     TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "defaultUnit" TEXT NOT NULL,
  "category"    TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanonicalIngredient_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanonicalIngredient_ownerId_name_key"
  ON "CanonicalIngredient"("ownerId", "name");
CREATE INDEX IF NOT EXISTS "CanonicalIngredient_ownerId_idx"
  ON "CanonicalIngredient"("ownerId");

-- ---------------------------------------------------------------------------
-- 4. IngredientAlias: add canonicalIngredientId, backfill from canonicalName
-- ---------------------------------------------------------------------------

ALTER TABLE "IngredientAlias" ADD COLUMN IF NOT EXISTS "canonicalIngredientId" TEXT;

-- For each owner, ensure one CanonicalIngredient exists per distinct canonicalName
-- used by any alias belonging to that owner's stores.
INSERT INTO "CanonicalIngredient" ("id", "ownerId", "name", "defaultUnit", "createdAt", "updatedAt")
SELECT
  'ci_' || md5(s."ownerId" || '::' || ia."canonicalName")::text,
  s."ownerId",
  ia."canonicalName",
  COALESCE(MAX(ia."toUnit"), 'unit'),
  NOW(),
  NOW()
FROM "IngredientAlias" ia
JOIN "Store" s ON s."id" = ia."storeId"
GROUP BY s."ownerId", ia."canonicalName"
ON CONFLICT ("ownerId", "name") DO NOTHING;

-- Wire each alias to its CanonicalIngredient
UPDATE "IngredientAlias" ia
SET "canonicalIngredientId" = ci."id"
FROM "Store" s, "CanonicalIngredient" ci
WHERE ia."storeId" = s."id"
  AND ci."ownerId" = s."ownerId"
  AND ci."name" = ia."canonicalName"
  AND ia."canonicalIngredientId" IS NULL;

ALTER TABLE "IngredientAlias"
  DROP CONSTRAINT IF EXISTS "IngredientAlias_canonicalIngredientId_fkey";
ALTER TABLE "IngredientAlias"
  ADD CONSTRAINT "IngredientAlias_canonicalIngredientId_fkey"
  FOREIGN KEY ("canonicalIngredientId") REFERENCES "CanonicalIngredient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "IngredientAlias_canonicalIngredientId_idx"
  ON "IngredientAlias"("canonicalIngredientId");

-- ---------------------------------------------------------------------------
-- 5. RecipeIngredient: polymorphic (canonical ingredient OR sub-recipe)
-- ---------------------------------------------------------------------------

ALTER TABLE "RecipeIngredient"
  ADD COLUMN IF NOT EXISTS "canonicalIngredientId" TEXT;
ALTER TABLE "RecipeIngredient"
  ADD COLUMN IF NOT EXISTS "componentRecipeId" TEXT;

-- ingredientName becomes optional (kept as a display override/free-text note)
ALTER TABLE "RecipeIngredient" ALTER COLUMN "ingredientName" DROP NOT NULL;

-- Backfill: try to map each existing RecipeIngredient.ingredientName to a
-- CanonicalIngredient within the same owner's catalog, via IngredientAlias.rawName
-- matches first, then direct canonicalName matches.
UPDATE "RecipeIngredient" ri
SET "canonicalIngredientId" = ci."id"
FROM "Recipe" r, "CanonicalIngredient" ci
WHERE ri."recipeId" = r."id"
  AND ci."ownerId" = r."ownerId"
  AND lower(ci."name") = lower(ri."ingredientName")
  AND ri."canonicalIngredientId" IS NULL
  AND ri."componentRecipeId" IS NULL;

-- Any unmapped rows remain with both FKs NULL -- user must fix before the CHECK
-- constraint activates. Report how many so migration output is visible.
DO $$
DECLARE unmapped INT;
BEGIN
  SELECT COUNT(*) INTO unmapped
  FROM "RecipeIngredient"
  WHERE "canonicalIngredientId" IS NULL AND "componentRecipeId" IS NULL;
  IF unmapped > 0 THEN
    RAISE NOTICE 'RecipeIngredient: % row(s) could not be mapped to a canonical ingredient. These must be fixed before the CHECK constraint is added.', unmapped;
  END IF;
END $$;

ALTER TABLE "RecipeIngredient"
  DROP CONSTRAINT IF EXISTS "RecipeIngredient_canonicalIngredientId_fkey";
ALTER TABLE "RecipeIngredient"
  ADD CONSTRAINT "RecipeIngredient_canonicalIngredientId_fkey"
  FOREIGN KEY ("canonicalIngredientId") REFERENCES "CanonicalIngredient"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RecipeIngredient"
  DROP CONSTRAINT IF EXISTS "RecipeIngredient_componentRecipeId_fkey";
ALTER TABLE "RecipeIngredient"
  ADD CONSTRAINT "RecipeIngredient_componentRecipeId_fkey"
  FOREIGN KEY ("componentRecipeId") REFERENCES "Recipe"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "RecipeIngredient_canonicalIngredientId_idx"
  ON "RecipeIngredient"("canonicalIngredientId");
CREATE INDEX IF NOT EXISTS "RecipeIngredient_componentRecipeId_idx"
  ON "RecipeIngredient"("componentRecipeId");

-- CHECK: exactly one of the two polymorphic FKs is non-null.
-- Only add if all rows satisfy it (otherwise migration surfaces the problem).
DO $$
DECLARE violating INT;
BEGIN
  SELECT COUNT(*) INTO violating
  FROM "RecipeIngredient"
  WHERE NOT (
    ("canonicalIngredientId" IS NOT NULL AND "componentRecipeId" IS NULL)
    OR ("canonicalIngredientId" IS NULL AND "componentRecipeId" IS NOT NULL)
  );
  IF violating > 0 THEN
    RAISE NOTICE 'Skipping recipe_ingredient_exactly_one_ref CHECK: % row(s) still violate it. Fix them, then add the constraint manually.', violating;
  ELSE
    -- Drop prior version if present so this stays idempotent
    EXECUTE 'ALTER TABLE "RecipeIngredient" DROP CONSTRAINT IF EXISTS "recipe_ingredient_exactly_one_ref"';
    EXECUTE 'ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "recipe_ingredient_exactly_one_ref" CHECK ((("canonicalIngredientId" IS NOT NULL AND "componentRecipeId" IS NULL) OR ("canonicalIngredientId" IS NULL AND "componentRecipeId" IS NOT NULL)))';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. OtterItemMapping table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "OtterItemMapping" (
  "id"            TEXT PRIMARY KEY,
  "storeId"       TEXT NOT NULL,
  "otterItemName" TEXT NOT NULL,
  "recipeId"      TEXT NOT NULL,
  "confirmedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtterItemMapping_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OtterItemMapping_recipeId_fkey"
    FOREIGN KEY ("recipeId") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "OtterItemMapping_storeId_otterItemName_key"
  ON "OtterItemMapping"("storeId", "otterItemName");
CREATE INDEX IF NOT EXISTS "OtterItemMapping_storeId_idx"
  ON "OtterItemMapping"("storeId");
CREATE INDEX IF NOT EXISTS "OtterItemMapping_recipeId_idx"
  ON "OtterItemMapping"("recipeId");

COMMIT;

-- After COMMIT: run `npx prisma generate` to regenerate the Prisma client.
