-- Store checks close themselves at the end of their window.
-- Additive only: one new column with a default, no change to existing rows.
--
-- "autoClosed" is true on a check the app closed when its window ended,
-- instead of crew pressing Submit. Its "content" keeps every task with
-- done = true or false, so the tasks nobody ticked are recorded as missed.
-- Every existing row was a crew submit with all tasks done: false is right.
ALTER TABLE "CheckSubmission" ADD COLUMN IF NOT EXISTS "autoClosed" BOOLEAN NOT NULL DEFAULT false;
