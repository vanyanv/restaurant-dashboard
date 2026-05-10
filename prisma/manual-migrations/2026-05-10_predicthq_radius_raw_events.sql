-- PredictHQ Suggested Radius cache + raw top event features for ML/labor explanations.

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "eventSignalRadiusProvider" text,
  ADD COLUMN IF NOT EXISTS "eventSignalRadiusUpdatedAt" timestamp(3);

ALTER TABLE "StoreEventSignal"
  ADD COLUMN IF NOT EXISTS "topEventTitle" text,
  ADD COLUMN IF NOT EXISTS "topEventCategory" text,
  ADD COLUMN IF NOT EXISTS "topEventStartsAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "topEventRank" double precision,
  ADD COLUMN IF NOT EXISTS "topEventLocalRank" double precision,
  ADD COLUMN IF NOT EXISTS "topEventAttendance" double precision,
  ADD COLUMN IF NOT EXISTS "topEventDistanceMiles" double precision,
  ADD COLUMN IF NOT EXISTS "majorEventCount" integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "highLocalRankEventCount" integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "StoreEventDetailSignal" (
  id text PRIMARY KEY,
  "storeId" text NOT NULL,
  "providerEventId" text NOT NULL,
  date date NOT NULL,
  "startsAt" timestamp(3),
  "endsAt" timestamp(3),
  title text,
  category text,
  labels jsonb,
  rank double precision,
  "localRank" double precision,
  attendance double precision,
  "distanceMiles" double precision,
  "venueName" text,
  "venueId" text,
  raw jsonb,
  "syncedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreEventDetailSignal_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StoreEventDetailSignal_storeId_providerEventId_key"
  ON "StoreEventDetailSignal" ("storeId", "providerEventId");
CREATE INDEX IF NOT EXISTS "StoreEventDetailSignal_storeId_date_idx"
  ON "StoreEventDetailSignal" ("storeId", date);
CREATE INDEX IF NOT EXISTS "StoreEventDetailSignal_storeId_date_localRank_idx"
  ON "StoreEventDetailSignal" ("storeId", date, "localRank" DESC);
CREATE INDEX IF NOT EXISTS "StoreEventDetailSignal_syncedAt_idx"
  ON "StoreEventDetailSignal" ("syncedAt" DESC);
