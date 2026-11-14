-- The owner can switch a checklist section off and back on. Off hides the
-- section and its tasks from crew (and from task counts, missed tasks and
-- auto-close) but keeps every task saved, so switching it on needs no retyping.
-- Additive only: one defaulted column; every existing section stays on.
ALTER TABLE "CheckSection" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT true;
