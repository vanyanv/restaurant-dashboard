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
-- STATUS: FULLY APPLIED 2026-08-19. The additive statements went in on
-- 2026-08-17; the DROPs followed once the data was archived.
--
-- The reasoning below said leaving the tables in place was "harmless" because
-- Prisma ignores tables it does not know about. That is true at runtime and
-- false for tooling: with the models gone from schema.prisma but the tables
-- still present, `prisma db push` refused to run without --accept-data-loss.
-- Adding one nullable column on 2026-08-19 therefore came with a prompt to
-- delete these three tables, and the next person in a hurry would have been a
-- single flag away from doing it with no archive at all. Deferring the decision
-- did not keep the data safe; it made an ordinary migration dangerous.
--
-- Before dropping, every row was archived to
-- prisma/manual-migrations/archive/2026-08-19_dead_table_archive.sql and the
-- archive was verified by replaying it into a scratch schema: 61/61 and 68/68
-- rows restored, metrics JSON byte-identical. DbSnapshot tracks table SIZES,
-- not contents, so it was never a backup.
--
-- Store.yelp*: all seven columns were dropped. Checked first — zero stores
-- carried a businessId, rating, review count or URL. The only non-null value in
-- the whole family was one yelpLastSearch timestamp, for a search that found
-- nothing.
--
-- `npm run db:drift` now reports schema-vs-database differences, so this class
-- of drift is visible before it turns into a data-loss prompt.
--
-- The original pre-flight counts, for the record:
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
