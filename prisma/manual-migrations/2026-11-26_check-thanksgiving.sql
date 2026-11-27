-- Thanksgiving hours for store checks (owner 2026-11-26): every Thanksgiving
-- the stores run only the Night check, open from 9:00 am and closing at
-- 6:00 pm. Per store and check, editable in Store checks > Checklists.
-- Additive: three columns with defaults, no data removed.
ALTER TABLE "CheckTemplate"
  ADD COLUMN IF NOT EXISTS "thanksgivingOff" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "thanksgivingOpensMin" INTEGER,
  ADD COLUMN IF NOT EXISTS "thanksgivingDueMin" INTEGER;

-- The owner's rule, for every store: Morning off, Night 9:00 am - 6:00 pm.
UPDATE "CheckTemplate" SET "thanksgivingOff" = true WHERE kind = 'MORNING';
UPDATE "CheckTemplate" SET "thanksgivingOpensMin" = 540, "thanksgivingDueMin" = 1080 WHERE kind = 'EVENING';
