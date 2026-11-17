-- 2026-11-17: phone speed, server batch.
--
-- 1. pg_stat_statements: per-query timings for the speed audit. Already
--    enabled on production on 2026-11-17 (owner's go in the thread); declared
--    in schema.prisma so `db push` / `db:drift` keep it.
-- 2. A covering index for joins from orders to their lines. With only
--    ("orderId") the planner read every order line (~250k rows) even for a
--    7-day window. CONCURRENTLY so the Otter sync keeps writing while it builds;
--    run it outside a transaction.

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrderItem_orderId_cover_idx"
  ON "OtterOrderItem" ("orderId", "name", "price", "quantity");
