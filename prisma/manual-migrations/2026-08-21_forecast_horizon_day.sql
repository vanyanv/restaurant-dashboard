-- F16 — the stored horizon was one less than the horizon the model forecast at.
--
-- `forecast()` iterates offset 1..14 from the last *observed* day. The nightly
-- runs at 10:00 UTC and the last observed day is normally the previous date, so
-- offset 1 produces a row whose forecastDate equals generatedAt::date. Every
-- consumer derived horizon as (forecastDate - generatedAt::date), making that
-- row horizon 0 — production holds horizons 0-13 for a 14-day forecast.
--
-- That silently broke horizon_calibration.load_horizon_widths, which filters
-- BETWEEN 1 AND 21: it discarded the next-day forecast entirely and returned a
-- dict keyed one step short of the offsets forecast() looks up by, so every
-- measured interval width was applied to the wrong horizon.
--
-- The offset is not constant either — trim_incomplete_trailing_days can drop an
-- extra trailing day and shift it for that night. So the horizon is recorded
-- rather than inferred. Existing rows stay NULL; consumers COALESCE to
-- (forecastDate - generatedAt::date) + 1 for them.
--
-- Apply per CLAUDE.md: `npm run db:drift` must say "No difference detected"
-- before you start. Additive nullable column, no rewrite, no data loss.
-- NEVER `prisma migrate dev` — it would reset the Neon production DB.

ALTER TABLE "ForecastDailyRevenue" ADD COLUMN IF NOT EXISTS "horizonDay" INTEGER;

COMMENT ON COLUMN "ForecastDailyRevenue"."horizonDay" IS
  'Steps ahead of the last observed day, 1-based, as forecast. Null before 2026-08-21.';
