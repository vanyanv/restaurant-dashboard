-- Migration: DailyCogsItem.partialCost flag
-- Date: 2026-04-22
--
-- Summary:
--   Add `partialCost` boolean to DailyCogsItem. Set by the recipe cost walk
--   (`computeRecipeCost().partial`) when at least one ingredient line has no
--   canonical cost or fails unit conversion. Orthogonal to `status`: a
--   COSTED row with `partialCost = true` is known-understated.
--
-- Note: `npx prisma db push` has already applied this. This file documents
-- the change for rollback parity with other manual migrations.

BEGIN;

ALTER TABLE "DailyCogsItem"
  ADD COLUMN IF NOT EXISTS "partialCost" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
