-- 2026-05-03 — Otter readiness for two new stores: replace the single-column
-- `OtterOrder.detailsFetchedAt` index with a partial index covering the actual
-- query pattern.
--
-- The drain (`where storeId = $1 AND detailsFetchedAt IS NULL AND
-- referenceTimeLocal < $2`) and the monitoring `getPendingOrderDetails()`
-- (`groupBy storeId where detailsFetchedAt IS NULL`) only ever touch the small
-- "pending" subset of the table. As OtterOrder grows 3x with the new stores,
-- a partial-on-NULL index stays tiny — successfully-drained rows leave the
-- index entirely.
--
-- Apply:
--
--   psql "$DATABASE_URL" -f prisma/manual-migrations/2026-05-03_otter_pending_details_index.sql
--
-- The drop is conditional so the migration is idempotent. CREATE INDEX
-- IF NOT EXISTS guards the new index. CONCURRENTLY would block running
-- inside a transaction (Postgres rule), so we use plain CREATE — the
-- table is small enough today that the lock is fine. Re-evaluate if
-- OtterOrder grows past ~1M rows.

BEGIN;

-- The old single-column index — schema.prisma no longer references it, but
-- prisma db push won't drop indexes that match its model state. Drop here.
DROP INDEX IF EXISTS "OtterOrder_detailsFetchedAt_idx";

-- New partial index. Order matches the drain's WHERE clause:
-- (storeId, referenceTimeLocal) for the per-store + ordered fetch.
CREATE INDEX IF NOT EXISTS "OtterOrder_pending_details_idx"
  ON "OtterOrder" ("storeId", "referenceTimeLocal")
  WHERE "detailsFetchedAt" IS NULL;

COMMIT;

-- Verify with:
--   \d "OtterOrder"
-- and confirm the planner uses it:
--   EXPLAIN SELECT "storeId", COUNT(*) FROM "OtterOrder"
--   WHERE "detailsFetchedAt" IS NULL GROUP BY "storeId";
