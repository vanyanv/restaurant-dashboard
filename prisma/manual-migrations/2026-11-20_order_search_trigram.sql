-- Orders search: trigram indexes so "contains" searches stop reading every order.
--
-- The Orders page searches with `ILIKE '%term%'` over three columns
-- (externalDisplayId, customerName, otterOrderId). A btree cannot answer a
-- leading wildcard, so every search read the whole OtterOrder table (live
-- 2026-11-20: 119k rows, 98-338 ms per query, and a search runs three of them).
-- A pg_trgm GIN index per column lets Postgres OR three bitmap index scans.
-- Terms shorter than 3 characters still fall back to a scan, with the same
-- results. No query changes: the same ILIKE predicates now use the indexes.
--
-- CONCURRENTLY so the table stays writable while each index builds; run each
-- statement on its own (not inside a transaction).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrder_externalDisplayId_trgm_idx"
  ON "OtterOrder" USING GIN ("externalDisplayId" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrder_customerName_trgm_idx"
  ON "OtterOrder" USING GIN ("customerName" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrder_otterOrderId_trgm_idx"
  ON "OtterOrder" USING GIN ("otterOrderId" gin_trgm_ops);
