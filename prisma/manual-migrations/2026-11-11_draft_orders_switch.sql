-- Draft orders: a per-store on/off switch, off by default.
-- Additive only: one new column with a default, no change to existing values.
ALTER TABLE "Store" ADD COLUMN IF NOT EXISTS "draftOrdersOn" BOOLEAN NOT NULL DEFAULT false;
