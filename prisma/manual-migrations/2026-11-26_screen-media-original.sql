-- Screens: keep the owner's untouched upload when the TV copy is redrawn.
-- Additive, nullable; existing rows keep NULL (their TV copy is the file as uploaded,
-- or the original was never kept).
ALTER TABLE "ScreenMedia" ADD COLUMN IF NOT EXISTS "originalKey" TEXT;
ALTER TABLE "ScreenMedia" ADD COLUMN IF NOT EXISTS "originalBytes" INTEGER;
