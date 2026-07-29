-- Drop the last remnant of the store-manager feature set.
-- The dashboard is owner-only: the MANAGER role, /manager routes, StoreManager
-- and DailyReport were removed in the 2026-04-18 cleanup, but the PrepTask
-- table (manager prep checklists) survived with zero application references.
-- Verified before this migration: PrepTask holds 0 rows in production, and the
-- "Shift" enum type is used by nothing else.
-- Applied via `prisma db push` on 2026-07-29; this file is the record.

DROP TABLE IF EXISTS "PrepTask";
DROP TYPE IF EXISTS "Shift";
