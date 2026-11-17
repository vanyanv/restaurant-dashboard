-- 2026-11-17: database speed review, fix 1.
--
-- A covering index for the reads that total raw orders over a date range:
-- commission on every P&L rollup (src/lib/counter/commission.ts) and the Orders
-- page strip (src/app/actions/order-actions.ts). Every column those queries
-- filter, group or sum on is in the index, so Postgres can answer from the
-- index alone instead of visiting the order rows, which are scattered across
-- the table by years of re-syncs. Same queries, same answers: no figure moves.
--
-- Measured on prod (read-only, 2026-11-17): 30 days of order totals read 3,613
-- table pages from disk right after the database woke (585 ms) vs 12 ms warm.
-- Locally, 90 days for 2 stores: 1,757 pages -> 474 with this index.
--
-- How to apply on production: run this BEFORE any `db push` carrying the
-- schema change (db push would build it without CONCURRENTLY and block Otter
-- writes while it builds). Run it on its own, outside any transaction.
-- Afterwards check it is valid:
--   SELECT indisvalid FROM pg_index
--    WHERE indexrelid = '"OtterOrder_store_time_fees_idx"'::regclass;
-- If false: DROP INDEX CONCURRENTLY "OtterOrder_store_time_fees_idx"; and rerun.
-- Then VACUUM (ANALYZE) "OtterOrder"; so the visibility map lets the reads
-- skip the table.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "OtterOrder_store_time_fees_idx"
  ON "OtterOrder" ("storeId", "referenceTimeLocal", "platform", "fulfillmentMode",
                   "orderStatus", "commission", "subtotal", "discount");
