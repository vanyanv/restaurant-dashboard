-- DecisionVerdict: the Act I verdict sentence, cached.
--
-- The Decisions page now leads with one narrated sentence instead of three
-- panels at equal weight (design principle #1). The sentence is written by an
-- LLM from a block of already-computed figures — it narrates, it never predicts
-- — and the narration guard in src/lib/decision-verdict-llm.ts rejects any
-- figure the page did not itself compute.
--
-- This table exists for cost, not for history. /dashboard/decisions is
-- server-rendered, so without a cache every page view would be an API call.
-- Keyed on (scopeKey, asOfDate) with the fact block's hash alongside, narration
-- costs at most one call per scope per day, and re-costs only when the
-- underlying numbers actually move.
--
-- `scopeKey` rather than a nullable storeId in the unique index: the portfolio
-- view has no store, and Postgres compares NULLs as distinct, so
-- ("storeId" IS NULL, date) would admit unlimited duplicate aggregate rows.
-- scopeKey is 'ALL' there and the store id otherwise. storeId is kept as a
-- real, nullable FK so a deleted store takes its verdicts with it.
--
-- `model` is null when the deterministic composer wrote the line — no API key,
-- a failed call, or a candidate the guard rejected. That is a normal state, not
-- an error: the page always has a verdict.
CREATE TABLE IF NOT EXISTS "DecisionVerdict" (
  "id"         TEXT PRIMARY KEY,
  "scopeKey"   TEXT NOT NULL,
  "storeId"    TEXT,
  "asOfDate"   DATE NOT NULL,
  "inputsHash" TEXT NOT NULL,
  "line"       TEXT NOT NULL,
  "model"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DecisionVerdict_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One verdict per scope per day; a moved inputsHash updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS "DecisionVerdict_scopeKey_asOfDate_key"
  ON "DecisionVerdict" ("scopeKey", "asOfDate");

-- Retention sweeps read by date.
CREATE INDEX IF NOT EXISTS "DecisionVerdict_asOfDate_idx"
  ON "DecisionVerdict" ("asOfDate");
