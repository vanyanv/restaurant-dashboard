-- Crew & PINs: a mobile number per crew member, for the "Text" button that
-- opens the owner's phone with the PIN message ready. Nullable, no backfill.
ALTER TABLE "CrewMember" ADD COLUMN IF NOT EXISTS "phone" TEXT;
