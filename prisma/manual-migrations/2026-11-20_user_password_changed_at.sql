-- 2026-11-20: User.passwordChangedAt
--
-- A password change now ends every other session for that person: the jwt
-- callback (src/lib/auth.ts) refuses a token issued before this time.
-- Nullable, no default, no backfill: existing users keep their sessions
-- until they next change their password. Metadata-only on Postgres, safe on
-- a live database. Apply before deploying the code that reads it.

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);
