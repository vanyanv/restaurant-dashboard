-- Migration: cost-audit follow-ups
-- Date: 2026-05-02
--
-- Two additive changes from the cost-calculation audit:
--
--   1. DailyCogsItem.costSource — nullable string capturing whether the
--      materialized unitCost came from invoice data, manual prices, an
--      explicit foodCostOverride, or a mix. Lets the dashboard distinguish
--      "real $" rows from "best guess" rows. Schema-side this is a plain
--      `String?` column; `prisma db push` would also create it, but we
--      ship it here so the chat branch (which holds real Recipe + DailyCogsItem
--      data via the multi-tenant sync) gets the same column without
--      `--accept-data-loss`.
--
--   2. Recipe.servingSize CHECK constraint (> 0). Every existing row already
--      has servingSize == 1 (verified 2026-05-02 against both DBs); the
--      check is purely a future-data guardrail so a divide-by-servingSize
--      consumer can't end up with Infinity / NaN. Idempotent via DO/EXCEPTION.
--
-- Apply order:
--   DATABASE_URL=$DATABASE_URL  npx prisma db execute \
--     --file prisma/manual-migrations/2026-05-02_cost_audit_followups.sql \
--     --schema prisma/schema.prisma
--   DATABASE_URL=$DATABASE_URL2 npx prisma db execute \
--     --file prisma/manual-migrations/2026-05-02_cost_audit_followups.sql \
--     --schema prisma/schema.prisma
--
-- Verify clean diff afterward (both DBs should print "No difference detected."):
--   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma
--   DATABASE_URL=$DATABASE_URL2 npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma

BEGIN;

-- (1) DailyCogsItem.costSource
ALTER TABLE "DailyCogsItem"
  ADD COLUMN IF NOT EXISTS "costSource" TEXT;

-- (2) Recipe.servingSize > 0
DO $$
BEGIN
  ALTER TABLE "Recipe"
    ADD CONSTRAINT recipe_serving_size_positive CHECK ("servingSize" > 0);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

COMMIT;
