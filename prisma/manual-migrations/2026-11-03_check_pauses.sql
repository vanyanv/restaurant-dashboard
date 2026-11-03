-- Store checks: pause a store's checks while the owner trains crew.
-- Additive only: one new table, no change to existing rows.
--
-- A check whose window closes inside a pause is "paused" (never missed, late
-- or alerted). While a pause is open ("resumedAt" IS NULL) the crew page is
-- practice mode and Submit saves nothing.
CREATE TABLE IF NOT EXISTS "CheckPause" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "pausedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resumedAt" TIMESTAMP(3),

    CONSTRAINT "CheckPause_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CheckPause_storeId_pausedAt_idx" ON "CheckPause"("storeId", "pausedAt");

DO $$ BEGIN
  ALTER TABLE "CheckPause" ADD CONSTRAINT "CheckPause_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
