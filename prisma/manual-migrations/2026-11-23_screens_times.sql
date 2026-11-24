-- Screens: pictures for part of the week on one screen, and "Which TV is which?".
-- Additive only. Run before deploying the code that reads it.
BEGIN;

ALTER TABLE "Screen" ADD COLUMN IF NOT EXISTS "identifyUntil" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ScreenTime" (
    "id" TEXT NOT NULL,
    "screenId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "playlistId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScreenTime_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ScreenTime_screenId_fkey" FOREIGN KEY ("screenId") REFERENCES "Screen"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScreenTime_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "ScreenPlaylist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ScreenTime_screenId_idx" ON "ScreenTime"("screenId");
CREATE INDEX IF NOT EXISTS "ScreenTime_playlistId_idx" ON "ScreenTime"("playlistId");

COMMIT;
