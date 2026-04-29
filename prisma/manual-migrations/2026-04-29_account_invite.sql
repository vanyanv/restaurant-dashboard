-- Migration: Account + Invite tenant boundary; accountId on owned models
-- Date: 2026-04-29
--
-- Summary:
--   Introduces an Account aggregate so multiple users can share the same
--   data set (the Invite-link signup flow). Backfills a single Account row
--   that gathers every existing user, store, invoice, recipe, canonical
--   ingredient, sku match, conversation, and embedding row.
--
-- Order of operations:
--   1. Create Account, Invite tables.
--   2. Insert one default Account, capture its id.
--   3. Add nullable accountId columns to every owner-scoped table.
--   4. Backfill all rows on those tables to the default Account id.
--   5. Set NOT NULL + add foreign keys + indexes.
--
-- Run this BEFORE `npx prisma db push` so the columns exist with valid
-- data; db push will then be a no-op for the changes that already
-- happened here.

BEGIN;

-- 1. Account + Invite tables --------------------------------------------------

CREATE TABLE "Account" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Invite" (
  "id"              TEXT PRIMARY KEY,
  "token"           TEXT NOT NULL UNIQUE,
  "accountId"       TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "expiresAt"       TIMESTAMP(3) NOT NULL,
  "usedAt"          TIMESTAMP(3),
  "usedByUserId"    TEXT,
  "revokedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "Invite_accountId_idx" ON "Invite"("accountId");
CREATE INDEX "Invite_token_idx"     ON "Invite"("token");

-- 2. Seed the default Account (single tenant for now) ------------------------
--    Use a deterministic id so re-running this migration is a no-op.

INSERT INTO "Account" ("id", "name", "createdAt", "updatedAt")
VALUES ('acc_default_chrisneddys', 'Chris Neddy''s', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

-- 3. Add nullable accountId on every owner-scoped table ----------------------

ALTER TABLE "User"                         ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Store"                        ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Invoice"                      ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Recipe"                       ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "CanonicalIngredient"          ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "IngredientSkuMatch"           ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "Conversation"                 ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "InvoiceLineEmbedding"         ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "MenuItemEmbedding"            ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "RecipeEmbedding"              ADD COLUMN IF NOT EXISTS "accountId" TEXT;
ALTER TABLE "CanonicalIngredientEmbedding" ADD COLUMN IF NOT EXISTS "accountId" TEXT;

-- 4. Backfill every existing row to the default account ----------------------

UPDATE "User"                         SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "Store"                        SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "Invoice"                      SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "Recipe"                       SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "CanonicalIngredient"          SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "IngredientSkuMatch"           SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "Conversation"                 SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "InvoiceLineEmbedding"         SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "MenuItemEmbedding"            SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "RecipeEmbedding"              SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;
UPDATE "CanonicalIngredientEmbedding" SET "accountId" = 'acc_default_chrisneddys' WHERE "accountId" IS NULL;

-- 5. Lock down the new column: NOT NULL, FK, indexes -------------------------

ALTER TABLE "User"                         ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Store"                        ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Invoice"                      ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Recipe"                       ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "CanonicalIngredient"          ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "IngredientSkuMatch"           ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "Conversation"                 ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "InvoiceLineEmbedding"         ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "MenuItemEmbedding"            ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "RecipeEmbedding"              ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "CanonicalIngredientEmbedding" ALTER COLUMN "accountId" SET NOT NULL;

ALTER TABLE "User"
  ADD CONSTRAINT "User_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Store"
  ADD CONSTRAINT "Store_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Recipe"
  ADD CONSTRAINT "Recipe_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CanonicalIngredient"
  ADD CONSTRAINT "CanonicalIngredient_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IngredientSkuMatch"
  ADD CONSTRAINT "IngredientSkuMatch_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InvoiceLineEmbedding"
  ADD CONSTRAINT "InvoiceLineEmbedding_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MenuItemEmbedding"
  ADD CONSTRAINT "MenuItemEmbedding_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RecipeEmbedding"
  ADD CONSTRAINT "RecipeEmbedding_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanonicalIngredientEmbedding"
  ADD CONSTRAINT "CanonicalIngredientEmbedding_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON UPDATE CASCADE;

ALTER TABLE "Invite"
  ADD CONSTRAINT "Invite_usedByUserId_fkey"
  FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON UPDATE CASCADE;

-- Indexes on accountId for fast scoped reads ----------------------------------

CREATE INDEX IF NOT EXISTS "User_accountId_idx"                         ON "User"("accountId");
CREATE INDEX IF NOT EXISTS "Store_accountId_idx"                        ON "Store"("accountId");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_idx"                      ON "Invoice"("accountId");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_createdAt_idx"            ON "Invoice"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_vendorName_invoiceDate_idx" ON "Invoice"("accountId", "vendorName", "invoiceDate");
CREATE INDEX IF NOT EXISTS "Recipe_accountId_idx"                       ON "Recipe"("accountId");
CREATE INDEX IF NOT EXISTS "CanonicalIngredient_accountId_idx"          ON "CanonicalIngredient"("accountId");
CREATE INDEX IF NOT EXISTS "IngredientSkuMatch_accountId_idx"           ON "IngredientSkuMatch"("accountId");
CREATE INDEX IF NOT EXISTS "Conversation_accountId_updatedAt_idx"       ON "Conversation"("accountId", "updatedAt");
CREATE INDEX IF NOT EXISTS "InvoiceLineEmbedding_accountId_idx"         ON "InvoiceLineEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "MenuItemEmbedding_accountId_idx"            ON "MenuItemEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "RecipeEmbedding_accountId_idx"              ON "RecipeEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "CanonicalIngredientEmbedding_accountId_idx" ON "CanonicalIngredientEmbedding"("accountId");

-- Account-scoped uniques (paired with the existing owner-scoped uniques) -----

ALTER TABLE "Recipe"
  ADD CONSTRAINT "Recipe_accountId_itemName_category_key"
  UNIQUE ("accountId", "itemName", "category");

ALTER TABLE "CanonicalIngredient"
  ADD CONSTRAINT "CanonicalIngredient_accountId_name_key"
  UNIQUE ("accountId", "name");

ALTER TABLE "IngredientSkuMatch"
  ADD CONSTRAINT "IngredientSkuMatch_accountId_vendorName_sku_key"
  UNIQUE ("accountId", "vendorName", "sku");

COMMIT;
