-- 2026-11-27: delete crew check photos from storage after a set number of days.
-- Additive only. The live account gets NULL (keep forever) so nothing is deleted
-- until the owner confirms the first purge; new accounts get 7.
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "checkPhotoKeepDays" INTEGER;
ALTER TABLE "Account" ALTER COLUMN "checkPhotoKeepDays" SET DEFAULT 7;
ALTER TABLE "CheckMark" ADD COLUMN IF NOT EXISTS "photoPurgedAt" TIMESTAMP(3);
ALTER TABLE "CheckPhoto" ADD COLUMN IF NOT EXISTS "purgedAt" TIMESTAMP(3);
