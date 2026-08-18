-- HarriShift — scheduled shifts from Harri's /scheduling/api/v1 service.
-- The first intra-day labor signal in the integration; joins to
-- OtterHourlySummary on (storeId, date) to produce hour-of-day SPLH.
--
-- startTime/endTime store LOCAL wall-clock encoded as UTC (same convention as
-- Otter's reference_time_local_without_tz), so hour extraction needs no tz math.
--
-- Applied to production 2026-08-18. Convention: db push / direct DDL + this
-- file as the record. Never `prisma migrate dev` against this database.

CREATE TABLE IF NOT EXISTS "HarriShift" (
  "id"           TEXT NOT NULL,
  "storeId"      TEXT NOT NULL,
  "harriShiftId" BIGINT NOT NULL,
  "date"         DATE NOT NULL,
  "weekStart"    DATE NOT NULL,
  "startTime"    TIMESTAMP(3) NOT NULL,
  "endTime"      TIMESTAMP(3) NOT NULL,
  "minutes"      INTEGER NOT NULL,
  "userId"       INTEGER,
  "isVirtual"    BOOLEAN NOT NULL DEFAULT false,
  "positionCode" TEXT NOT NULL,
  "positionName" TEXT,
  "categoryCode" TEXT,
  "categoryName" TEXT,
  "status"       TEXT,
  "syncedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HarriShift_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "HarriShift_harriShiftId_key"
  ON "HarriShift"("harriShiftId");
CREATE INDEX IF NOT EXISTS "HarriShift_storeId_date_idx"
  ON "HarriShift"("storeId", "date");
CREATE INDEX IF NOT EXISTS "HarriShift_storeId_weekStart_idx"
  ON "HarriShift"("storeId", "weekStart");

DO $$ BEGIN
  ALTER TABLE "HarriShift"
    ADD CONSTRAINT "HarriShift_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
