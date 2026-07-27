-- RecipeMappingProposal: at most one PENDING proposal per (accountId, otterItemName).
-- Partial unique indexes can't be expressed in the Prisma schema, so this rides
-- alongside `prisma db push` per the manual-migrations convention.
--
-- Apply with:
--   npx prisma db execute --file prisma/manual-migrations/2026-07-26_recipe-mapping-proposals.sql

CREATE UNIQUE INDEX IF NOT EXISTS "RecipeMappingProposal_pending_one_per_item"
  ON "RecipeMappingProposal"("accountId", "otterItemName")
  WHERE "status" = 'PENDING';
