-- How-to help on store check tasks: steps in English and Spanish, and the
-- owner's reference photos (storage keys). Additive: existing tasks get no help.
ALTER TABLE "CheckItem" ADD COLUMN IF NOT EXISTS "helpEn" TEXT;
ALTER TABLE "CheckItem" ADD COLUMN IF NOT EXISTS "helpEs" TEXT;
ALTER TABLE "CheckItem" ADD COLUMN IF NOT EXISTS "helpPhotos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
