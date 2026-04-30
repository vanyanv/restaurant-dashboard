-- DbSnapshot: daily capture of pg_database_size + per-table breakdown for the
-- monitoring page's DB-growth chart. One row per day via the unique date key.

CREATE TABLE IF NOT EXISTS "DbSnapshot" (
  "id"         TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "date"       DATE NOT NULL,
  "totalBytes" BIGINT NOT NULL,
  "perTable"   JSONB NOT NULL,
  CONSTRAINT "DbSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "DbSnapshot_date_key" ON "DbSnapshot" ("date");
CREATE INDEX IF NOT EXISTS "DbSnapshot_date_idx" ON "DbSnapshot" ("date" DESC);
