-- Remove schema that no code reads or writes.
--
-- From the 2026-08-17 product audit (see the "Built, paid for, and never
-- shown" section). Each target was checked with a repo-wide grep across
-- src/, ml/ and scripts/ before removal:
--
--   InvoiceSyncLog       zero readers, zero writers — superseded by JobRun,
--                        which is what /dashboard/admin/monitoring/activity
--                        actually reads.
--   AiForecastRun        superseded by the Forecast* tables. Its only
--                        remaining reference was its own retention policy.
--   VercelUsageSnapshot  its doc-comment described a 15-minute GET /v1/usage
--                        poller that was never built. Nothing ever inserted a
--                        row; the only reference was the cleanup cron deleting
--                        from an always-empty table.
--   Store.yelp*          the Yelp integration was deleted (routes gone, env
--                        key gone, README references stale). Seven columns and
--                        an index survived it with zero code references.
--
-- STATUS: the two additive statements at the bottom are APPLIED (2026-08-17).
-- The DROP statements are NOT applied and are pending an explicit decision,
-- because a pre-flight count showed the "dead" tables are not empty:
--
--   InvoiceSyncLog        61 rows
--   VercelUsageSnapshot   68 rows   (so something wrote them once, even though
--                                    no writer exists in the tree today)
--   AiForecastRun          0 rows
--   Store.yelp*            1 store carries non-null values
--
-- "Dead" was established about *readers*, which is still true — nothing in
-- src/, ml/ or scripts/ reads any of them. But dropping is irreversible and
-- these hold history, so the destructive half waits for a call. The Prisma
-- schema no longer declares these models, which is harmless: Prisma ignores
-- tables it doesn't know about, so the app runs correctly either way.
--
-- To apply, run these against the database with `prisma db push`
-- (NEVER `migrate dev` — that would reset the Neon production database).

DROP TABLE IF EXISTS "InvoiceSyncLog";
DROP TABLE IF EXISTS "AiForecastRun";
DROP TABLE IF EXISTS "VercelUsageSnapshot";

DROP INDEX IF EXISTS "Store_yelpBusinessId_idx";

ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpBusinessId";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpRating";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpReviewCount";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpUrl";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpUpdatedAt";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpSearchTerm";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "yelpLastSearch";

-- Anomalies are now aged out of the open feed rather than staying OPEN
-- forever; see src/lib/anomaly-window.ts. Additive enum value.
ALTER TYPE "AnomalyStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Growth opportunities record the horizon their dollar impact covers, so the
-- Decisions cards can normalise instead of labelling every figure "/wk".
ALTER TABLE "GrowthOpportunity"
  ADD COLUMN IF NOT EXISTS "horizonDays" INTEGER NOT NULL DEFAULT 7;
