-- Screens: a lasting record of pairing changes (runtime logs on the plan last an hour).
-- Additive: a new table, nothing existing changes.
CREATE TABLE IF NOT EXISTS "ScreenEvent" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "kind" TEXT NOT NULL,
  "tv" TEXT NOT NULL,
  "screenName" TEXT,
  "storeId" TEXT,
  "device" TEXT,
  "userId" TEXT,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScreenEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ScreenEvent_accountId_at_idx" ON "ScreenEvent"("accountId", "at" DESC);
CREATE INDEX IF NOT EXISTS "ScreenEvent_tv_idx" ON "ScreenEvent"("tv");
