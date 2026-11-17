-- 2026-11-17: phone speed, server batch.
--
-- 1. pg_stat_statements: per-query timings for the speed audit. Already
--    enabled on production on 2026-11-17 (owner's go in the thread); declared
--    in schema.prisma so `db push` / `db:drift` keep it.
-- 2. A covering index for joins from orders to their lines. With only
--    ("orderId") the planner read every order line (~250k rows) even for a
--    7-day window. CONCURRENTLY so the Otter sync keeps writing while it builds;
--    run it outside a transaction.
--
-- How to apply on production: run this file BEFORE any `db push` that carries
-- the schema change (db push would build the index without CONCURRENTLY and
-- block Otter writes while it builds). Run each statement on its own, not
-- under `psql -1` or any transaction wrapper.
--
-- If the build is interrupted it leaves an INVALID index, and IF NOT EXISTS
-- would then skip it on a rerun. Check afterwards:
--   SELECT indisvalid FROM pg_index
--    WHERE indexrelid = '"OtterOrderItem_orderId_cover_idx"'::regclass;
-- If false: DROP INDEX CONCURRENTLY "OtterOrderItem_orderId_cover_idx";
-- and run the CREATE again.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrderItem_orderId_cover_idx"
  ON "OtterOrderItem" ("orderId", "name", "price", "quantity");
