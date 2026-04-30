-- Migration: bring DATABASE_URL2 (chat / vector branch) up to current schema
-- Date: 2026-04-30
-- Target: $DATABASE_URL2 only. The primary DB (DATABASE_URL) is already up-to-date.
--
-- Background:
--   The multi-tenant refactor (Account model + accountId scope columns,
--   Invite, monitoring tables) was applied to the primary DB via
--   `prisma db push` but never reached the chat-layer Neon branch. The chat
--   page hits the chat branch via `chatPrisma`, so any query that
--   references `Conversation.accountId` (and most chat queries do) errors
--   with: column "(not available)" does not exist.
--
--   This file is the verbatim output of `prisma migrate diff
--   --from-config-datasource --to-schema prisma/schema.prisma --script`
--   run with DATABASE_URL pointed at $DATABASE_URL2, with one critical
--   adjustment: every `ADD COLUMN ... NOT NULL` is rewritten as `ADD COLUMN
--   ... NOT NULL DEFAULT 'acc_default_chrisneddys'` followed by `DROP
--   DEFAULT`, because the chat branch has real rows in every affected
--   table (User=1, Store=3, Invoice=82, Recipe=60, CanonicalIngredient=73,
--   IngredientSkuMatch=83, Conversation=1, embeddings=1010 total). A bare
--   `ADD COLUMN NOT NULL` would error on populated tables.
--
--   The default `acc_default_chrisneddys` matches the single Account row
--   in the primary DB. After this migration runs, every existing row on
--   the chat branch is owned by that account, mirroring the primary DB.
--
-- Apply order:
--   1. (optional) sanity-check current state: `npx prisma migrate diff
--      --from-config-datasource --to-schema prisma/schema.prisma` with
--      DATABASE_URL=$DATABASE_URL2 — should print this same delta.
--   2. Apply this file:
--        DATABASE_URL=$DATABASE_URL2 npx prisma db execute \
--          --file prisma/manual-migrations/2026-04-30_chat_db_multi_tenant_sync.sql \
--          --schema prisma/schema.prisma
--   3. Verify clean diff:
--        DATABASE_URL=$DATABASE_URL2 npx prisma migrate diff \
--          --from-config-datasource --to-schema prisma/schema.prisma
--      should report "No difference detected."
--   4. /dashboard/chat should now load.

-- ---------------------------------------------------------------------------
-- 1. New enum value (must come before tables that might reference DEVELOPER,
--    none here, but keeping it at the top to mirror the diff output).
--    Postgres 12+ allows ALTER TYPE ... ADD VALUE inside a transaction so
--    long as the new value is not used in the same transaction.
-- ---------------------------------------------------------------------------

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DEVELOPER';

-- ---------------------------------------------------------------------------
-- 2. New tables, ordered so that FKs added later resolve.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- Seed the single tenant. Matches `acc_default_chrisneddys` on the primary DB.
INSERT INTO "Account" ("id", "name", "createdAt", "updatedAt")
VALUES ('acc_default_chrisneddys', 'Chris Neddy''s', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE IF NOT EXISTS "Invite" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- JobStatus enum must exist before JobRun. CREATE TYPE doesn't support
-- IF NOT EXISTS, so wrap in DO block.
DO $$ BEGIN
    CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILURE', 'PARTIAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "JobRun" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "storeId" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "status" "JobStatus" NOT NULL DEFAULT 'RUNNING',
    "rowsWritten" INTEGER,
    "metadata" JSONB,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AiUsageEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL,
    "storeId" TEXT,
    "userId" TEXT,
    "durationMs" INTEGER,
    CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ErrorEvent" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "route" TEXT,
    "method" TEXT,
    "status" INTEGER,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "userId" TEXT,
    "storeId" TEXT,
    "metadata" JSONB,
    CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ChatTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "storeId" TEXT,
    "userMessage" TEXT NOT NULL,
    "assistantMessage" TEXT,
    "toolsUsed" TEXT[],
    "aiUsageEventId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OK',
    "finishReason" TEXT,
    "errorMessage" TEXT,
    "toolErrors" JSONB,
    "feedback" TEXT,
    CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CacheStat" (
    "id" TEXT NOT NULL,
    "hourBucket" TIMESTAMP(3) NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "misses" INTEGER NOT NULL DEFAULT 0,
    "writes" INTEGER NOT NULL DEFAULT 0,
    "busts" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CacheStat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DbSnapshot" (
    "id" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" DATE NOT NULL,
    "totalBytes" BIGINT NOT NULL,
    "perTable" JSONB NOT NULL,
    CONSTRAINT "DbSnapshot_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 3. Add accountId (NOT NULL) to populated tables.
--    Pattern: ADD COLUMN with DEFAULT, then DROP DEFAULT — Postgres
--    backfills existing rows from the default in one shot.
-- ---------------------------------------------------------------------------

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "User" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "Store" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "Invoice"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys',
  ADD COLUMN IF NOT EXISTS "isReturn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invoice" ALTER COLUMN "accountId" DROP DEFAULT;
-- isReturn keeps its DEFAULT false (matches schema).

ALTER TABLE "Recipe"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "Recipe" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "CanonicalIngredient"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "CanonicalIngredient" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "IngredientSkuMatch"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "IngredientSkuMatch" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "Conversation" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "InvoiceLineEmbedding"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "InvoiceLineEmbedding" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "MenuItemEmbedding"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "MenuItemEmbedding" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "RecipeEmbedding"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "RecipeEmbedding" ALTER COLUMN "accountId" DROP DEFAULT;

ALTER TABLE "CanonicalIngredientEmbedding"
  ADD COLUMN IF NOT EXISTS "accountId" TEXT NOT NULL DEFAULT 'acc_default_chrisneddys';
ALTER TABLE "CanonicalIngredientEmbedding" ALTER COLUMN "accountId" DROP DEFAULT;

-- PnlNarrativeEmbedding already has accountId on the chat branch (the diff
-- only flagged a missing relation). The FK is added below.

-- ---------------------------------------------------------------------------
-- 4. Indexes (CREATE INDEX IF NOT EXISTS is safe to re-run).
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "Invite_token_key" ON "Invite"("token");
CREATE INDEX IF NOT EXISTS "Invite_accountId_idx" ON "Invite"("accountId");
CREATE INDEX IF NOT EXISTS "Invite_token_idx" ON "Invite"("token");
CREATE INDEX IF NOT EXISTS "JobRun_jobName_startedAt_idx" ON "JobRun"("jobName", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "JobRun_status_startedAt_idx" ON "JobRun"("status", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_occurredAt_idx" ON "AiUsageEvent"("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_feature_occurredAt_idx" ON "AiUsageEvent"("feature", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ErrorEvent_occurredAt_idx" ON "ErrorEvent"("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ErrorEvent_source_occurredAt_idx" ON "ErrorEvent"("source", "occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatTurn_occurredAt_idx" ON "ChatTurn"("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatTurn_conversationId_occurredAt_idx" ON "ChatTurn"("conversationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "CacheStat_hourBucket_idx" ON "CacheStat"("hourBucket" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "CacheStat_hourBucket_keyPrefix_key" ON "CacheStat"("hourBucket", "keyPrefix");
CREATE UNIQUE INDEX IF NOT EXISTS "DbSnapshot_date_key" ON "DbSnapshot"("date");
CREATE INDEX IF NOT EXISTS "DbSnapshot_date_idx" ON "DbSnapshot"("date" DESC);

CREATE INDEX IF NOT EXISTS "CanonicalIngredient_accountId_idx" ON "CanonicalIngredient"("accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "CanonicalIngredient_accountId_name_key" ON "CanonicalIngredient"("accountId", "name");
CREATE INDEX IF NOT EXISTS "CanonicalIngredientEmbedding_accountId_idx" ON "CanonicalIngredientEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "Conversation_accountId_updatedAt_idx" ON "Conversation"("accountId", "updatedAt");
CREATE INDEX IF NOT EXISTS "IngredientSkuMatch_accountId_idx" ON "IngredientSkuMatch"("accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "IngredientSkuMatch_accountId_vendorName_sku_key" ON "IngredientSkuMatch"("accountId", "vendorName", "sku");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_idx" ON "Invoice"("accountId");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_createdAt_idx" ON "Invoice"("accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_vendorName_invoiceDate_idx" ON "Invoice"("accountId", "vendorName", "invoiceDate");
CREATE INDEX IF NOT EXISTS "Invoice_accountId_isReturn_idx" ON "Invoice"("accountId", "isReturn");
CREATE INDEX IF NOT EXISTS "InvoiceLineEmbedding_accountId_idx" ON "InvoiceLineEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "MenuItemEmbedding_accountId_idx" ON "MenuItemEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "Recipe_accountId_idx" ON "Recipe"("accountId");
CREATE UNIQUE INDEX IF NOT EXISTS "Recipe_accountId_itemName_category_key" ON "Recipe"("accountId", "itemName", "category");
CREATE INDEX IF NOT EXISTS "RecipeEmbedding_accountId_idx" ON "RecipeEmbedding"("accountId");
CREATE INDEX IF NOT EXISTS "Store_accountId_idx" ON "Store"("accountId");
CREATE INDEX IF NOT EXISTS "User_accountId_idx" ON "User"("accountId");

-- ---------------------------------------------------------------------------
-- 5. Foreign keys. Each is idempotent via DO/EXCEPTION (FKs don't have IF NOT EXISTS).
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "Invite" ADD CONSTRAINT "Invite_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Invite" ADD CONSTRAINT "Invite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Invite" ADD CONSTRAINT "Invite_usedByUserId_fkey" FOREIGN KEY ("usedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Store" ADD CONSTRAINT "Store_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CanonicalIngredient" ADD CONSTRAINT "CanonicalIngredient_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "IngredientSkuMatch" ADD CONSTRAINT "IngredientSkuMatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "InvoiceLineEmbedding" ADD CONSTRAINT "InvoiceLineEmbedding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "MenuItemEmbedding" ADD CONSTRAINT "MenuItemEmbedding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RecipeEmbedding" ADD CONSTRAINT "RecipeEmbedding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CanonicalIngredientEmbedding" ADD CONSTRAINT "CanonicalIngredientEmbedding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PnlNarrativeEmbedding" ADD CONSTRAINT "PnlNarrativeEmbedding_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ChatTurn" ADD CONSTRAINT "ChatTurn_aiUsageEventId_fkey" FOREIGN KEY ("aiUsageEventId") REFERENCES "AiUsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
