-- Phase 1 of dev-monitoring (additive): adds DEVELOPER role and 5 monitoring
-- tables. See docs/superpowers/specs/2026-04-30-dev-monitoring-design.md.
--
-- Additive only: InvoiceSyncLog is NOT dropped here (Phase 9 handles that).
--
-- This file matches the project's hand-rolled "prisma/manual-migrations/"
-- convention (we don't use Prisma's migrations/ directory because the live
-- DB has no _prisma_migrations baseline). Apply with `prisma db execute`
-- against the target DB.

-- ─── Role enum: add DEVELOPER ──────────────────────────────────────────────
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'DEVELOPER';

-- ─── JobStatus enum ────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILURE', 'PARTIAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── JobRun ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "JobRun" (
  "id"           TEXT NOT NULL,
  "jobName"      TEXT NOT NULL,
  "storeId"      TEXT,
  "triggeredBy"  TEXT NOT NULL,
  "startedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"  TIMESTAMP(3),
  "durationMs"   INTEGER,
  "status"       "JobStatus" NOT NULL DEFAULT 'RUNNING',
  "rowsWritten"  INTEGER,
  "metadata"     JSONB,
  "errorMessage" TEXT,
  "errorStack"   TEXT,

  CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "JobRun_jobName_startedAt_idx" ON "JobRun" ("jobName", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "JobRun_status_startedAt_idx"  ON "JobRun" ("status", "startedAt" DESC);

DO $$ BEGIN
  ALTER TABLE "JobRun"
    ADD CONSTRAINT "JobRun_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─── AiUsageEvent ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AiUsageEvent" (
  "id"               TEXT NOT NULL,
  "occurredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "feature"          TEXT NOT NULL,
  "provider"         TEXT NOT NULL,
  "model"            TEXT NOT NULL,
  "inputTokens"      INTEGER NOT NULL,
  "outputTokens"     INTEGER NOT NULL,
  "cachedTokens"     INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DECIMAL(10, 6) NOT NULL,
  "storeId"          TEXT,
  "userId"           TEXT,
  "durationMs"       INTEGER,

  CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiUsageEvent_occurredAt_idx"          ON "AiUsageEvent" ("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "AiUsageEvent_feature_occurredAt_idx"  ON "AiUsageEvent" ("feature", "occurredAt" DESC);

-- ─── ErrorEvent ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ErrorEvent" (
  "id"         TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source"     TEXT NOT NULL,
  "route"      TEXT,
  "method"     TEXT,
  "status"     INTEGER,
  "message"    TEXT NOT NULL,
  "stack"      TEXT,
  "userId"     TEXT,
  "storeId"    TEXT,
  "metadata"   JSONB,

  CONSTRAINT "ErrorEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ErrorEvent_occurredAt_idx"         ON "ErrorEvent" ("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ErrorEvent_source_occurredAt_idx"  ON "ErrorEvent" ("source", "occurredAt" DESC);

-- ─── ChatTurn ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ChatTurn" (
  "id"               TEXT NOT NULL,
  "conversationId"   TEXT NOT NULL,
  "occurredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId"           TEXT,
  "storeId"          TEXT,
  "userMessage"      TEXT NOT NULL,
  "assistantMessage" TEXT,
  "toolsUsed"        TEXT[],
  "aiUsageEventId"   TEXT,
  "status"           TEXT NOT NULL DEFAULT 'OK',
  "finishReason"     TEXT,
  "errorMessage"     TEXT,
  "toolErrors"       JSONB,
  "feedback"         TEXT,

  CONSTRAINT "ChatTurn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ChatTurn_occurredAt_idx"                ON "ChatTurn" ("occurredAt" DESC);
CREATE INDEX IF NOT EXISTS "ChatTurn_conversationId_occurredAt_idx" ON "ChatTurn" ("conversationId", "occurredAt");

-- ─── CacheStat ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "CacheStat" (
  "id"         TEXT NOT NULL,
  "hourBucket" TIMESTAMP(3) NOT NULL,
  "keyPrefix"  TEXT NOT NULL,
  "hits"       INTEGER NOT NULL DEFAULT 0,
  "misses"     INTEGER NOT NULL DEFAULT 0,
  "writes"     INTEGER NOT NULL DEFAULT 0,
  "busts"      INTEGER NOT NULL DEFAULT 0,
  "failures"   INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "CacheStat_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CacheStat_hourBucket_keyPrefix_key" ON "CacheStat" ("hourBucket", "keyPrefix");
CREATE INDEX        IF NOT EXISTS "CacheStat_hourBucket_idx"           ON "CacheStat" ("hourBucket" DESC);

-- ─── ChatTurn → AiUsageEvent FK + supporting index ─────────────────────────
DO $$ BEGIN
  ALTER TABLE "ChatTurn"
    ADD CONSTRAINT "ChatTurn_aiUsageEventId_fkey"
    FOREIGN KEY ("aiUsageEventId") REFERENCES "AiUsageEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "ChatTurn_aiUsageEventId_idx" ON "ChatTurn" ("aiUsageEventId");
