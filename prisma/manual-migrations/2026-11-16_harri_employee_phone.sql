-- Harri team directory: keep the mobile number Harri already sends, so
-- "Sync from Harri" can fill a crew member's empty Mobile field. Nullable.
ALTER TABLE "HarriEmployee" ADD COLUMN IF NOT EXISTS "phone" TEXT;
