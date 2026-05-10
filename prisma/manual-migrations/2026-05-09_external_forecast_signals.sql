-- Weather + PredictHQ forecast enrichment storage.
-- Additive migration: no existing forecast read paths are changed by DDL.

ALTER TABLE "Store"
  ADD COLUMN IF NOT EXISTS "latitude" double precision,
  ADD COLUMN IF NOT EXISTS "longitude" double precision,
  ADD COLUMN IF NOT EXISTS "geocodedAt" timestamp(3),
  ADD COLUMN IF NOT EXISTS "geocodeProvider" text,
  ADD COLUMN IF NOT EXISTS "geocodeConfidence" double precision,
  ADD COLUMN IF NOT EXISTS "eventSignalRadiusMiles" double precision;

CREATE INDEX IF NOT EXISTS "Store_latitude_longitude_idx"
  ON "Store" ("latitude", "longitude");

CREATE TABLE IF NOT EXISTS "StoreWeatherSignal" (
  "id"                          text PRIMARY KEY,
  "storeId"                     text NOT NULL,
  "date"                        date NOT NULL,
  "hour"                        integer NOT NULL,
  "temperatureC"                double precision,
  "apparentTemperatureC"        double precision,
  "precipitationMm"             double precision,
  "precipitationProbabilityPct" double precision,
  "windSpeedKph"                double precision,
  "relativeHumidityPct"         double precision,
  "weatherCode"                 integer,
  "provider"                    text NOT NULL DEFAULT 'open-meteo',
  "syncedAt"                    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreWeatherSignal_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StoreWeatherSignal_storeId_date_hour_key"
  ON "StoreWeatherSignal" ("storeId", "date", "hour");
CREATE INDEX IF NOT EXISTS "StoreWeatherSignal_storeId_date_idx"
  ON "StoreWeatherSignal" ("storeId", "date");
CREATE INDEX IF NOT EXISTS "StoreWeatherSignal_syncedAt_idx"
  ON "StoreWeatherSignal" ("syncedAt" DESC);

CREATE TABLE IF NOT EXISTS "StoreEventSignal" (
  "id"                  text PRIMARY KEY,
  "storeId"             text NOT NULL,
  "date"                date NOT NULL,
  "radiusMiles"         double precision,
  "hospitalityImpact"   double precision,
  "hospitalitySpend"    double precision,
  "attendance"          double precision,
  "eventCount"          integer NOT NULL DEFAULT 0,
  "sportsCount"         integer NOT NULL DEFAULT 0,
  "concertsCount"       integer NOT NULL DEFAULT 0,
  "festivalsCount"      integer NOT NULL DEFAULT 0,
  "performingArtsCount" integer NOT NULL DEFAULT 0,
  "communityCount"      integer NOT NULL DEFAULT 0,
  "conferencesCount"    integer NOT NULL DEFAULT 0,
  "exposCount"          integer NOT NULL DEFAULT 0,
  "provider"            text NOT NULL DEFAULT 'predicthq',
  "raw"                 jsonb,
  "syncedAt"            timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreEventSignal_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "StoreEventSignal_storeId_date_key"
  ON "StoreEventSignal" ("storeId", "date");
CREATE INDEX IF NOT EXISTS "StoreEventSignal_storeId_date_idx"
  ON "StoreEventSignal" ("storeId", "date");
CREATE INDEX IF NOT EXISTS "StoreEventSignal_syncedAt_idx"
  ON "StoreEventSignal" ("syncedAt" DESC);

CREATE TABLE IF NOT EXISTS "ExternalSignalSyncRun" (
  "id"          text PRIMARY KEY,
  "provider"    text NOT NULL,
  "storeId"     text,
  "startDate"   date,
  "endDate"     date,
  "status"      text NOT NULL,
  "rowsWritten" integer NOT NULL DEFAULT 0,
  "error"       text,
  "durationMs"  integer,
  "triggeredBy" text NOT NULL,
  "startedAt"   timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" timestamp(3),
  CONSTRAINT "ExternalSignalSyncRun_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ExternalSignalSyncRun_provider_startedAt_idx"
  ON "ExternalSignalSyncRun" ("provider", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "ExternalSignalSyncRun_storeId_provider_startedAt_idx"
  ON "ExternalSignalSyncRun" ("storeId", "provider", "startedAt" DESC);
CREATE INDEX IF NOT EXISTS "ExternalSignalSyncRun_status_startedAt_idx"
  ON "ExternalSignalSyncRun" ("status", "startedAt" DESC);
