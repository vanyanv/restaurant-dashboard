-- Store checks close themselves at the end of their window, and the owner
-- can look at each check photo and send it back.
-- Additive only: new columns, all nullable or defaulted; no existing row changes.
--
-- "autoClosed" is true on a check the app closed when its window ended,
-- instead of crew pressing Submit. Its "content" keeps every task with
-- done = true or false, so the tasks nobody ticked are recorded as missed.
-- Every existing row was a crew submit with all tasks done: false is right.
ALTER TABLE "CheckSubmission" ADD COLUMN IF NOT EXISTS "autoClosed" BOOLEAN NOT NULL DEFAULT false;

-- The owner's look at a check photo: "ok" or "redo", what they said, who and when.
ALTER TABLE "CheckMark" ADD COLUMN IF NOT EXISTS "review" TEXT;
ALTER TABLE "CheckMark" ADD COLUMN IF NOT EXISTS "reviewNote" TEXT;
ALTER TABLE "CheckMark" ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT;
ALTER TABLE "CheckMark" ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);
