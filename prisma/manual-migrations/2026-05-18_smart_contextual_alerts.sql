-- F21: Smart Contextual Alerts (issue #23). Adds the unified Alert + AlertPreference tables.
--
-- Sources (Phase 1 ships only ANOMALY_EVENT; PRICE_DELTA / HARRI_VARIANCE /
-- QUANTITY_SPIKE / NEW_PRODUCT activate in Phases 2 and 3). dedupeKey makes
-- ingestion idempotent so the nightly post-step can be re-run safely.

CREATE TYPE "AlertSource"   AS ENUM ('ANOMALY_EVENT', 'PRICE_DELTA', 'HARRI_VARIANCE', 'QUANTITY_SPIKE', 'NEW_PRODUCT');
CREATE TYPE "AlertTarget"   AS ENUM ('REVENUE', 'MENU_ITEM', 'INGREDIENT', 'LABOR', 'REFUNDS', 'PRICE', 'PRODUCT');
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WATCH', 'CRITICAL');
CREATE TYPE "AlertStatus"   AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'EXPLAINED');

CREATE TABLE "Alert" (
  "id"             TEXT PRIMARY KEY,
  "storeId"        TEXT NOT NULL,
  "source"         "AlertSource"   NOT NULL,
  "anomalyEventId" TEXT,
  "target"         "AlertTarget"   NOT NULL,
  "targetId"       TEXT,
  "severity"       "AlertSeverity" NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT,
  "metadata"       JSONB,
  "occurredOn"     DATE NOT NULL,
  "detectedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status"         "AlertStatus" NOT NULL DEFAULT 'OPEN',
  "acknowledgedAt" TIMESTAMP(3),
  "explanation"    TEXT,
  "dedupeKey"      TEXT NOT NULL,

  CONSTRAINT "Alert_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Alert_dedupeKey_key" ON "Alert" ("dedupeKey");
CREATE INDEX "Alert_storeId_status_occurredOn_idx"
  ON "Alert" ("storeId", "status", "occurredOn" DESC);
CREATE INDEX "Alert_status_detectedAt_idx"
  ON "Alert" ("status", "detectedAt" DESC);

CREATE TABLE "AlertPreference" (
  "id"          TEXT PRIMARY KEY,
  "accountId"   TEXT NOT NULL,
  "storeId"     TEXT,
  "target"      "AlertTarget",
  "minSeverity" "AlertSeverity" NOT NULL DEFAULT 'INFO',
  "muted"       BOOLEAN NOT NULL DEFAULT FALSE,
  "channels"    TEXT[] NOT NULL DEFAULT ARRAY['IN_APP']::TEXT[],
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AlertPreference_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "Account"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AlertPreference_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "Store"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- Postgres treats NULL as not-equal-to-NULL in unique constraints, which would
-- let multiple "global" rows (storeId = NULL, target = NULL) coexist for one
-- account. Use NULLS NOT DISTINCT so the uniqueness covers global rows too.
CREATE UNIQUE INDEX "AlertPreference_accountId_storeId_target_key"
  ON "AlertPreference" ("accountId", "storeId", "target") NULLS NOT DISTINCT;
CREATE INDEX "AlertPreference_accountId_idx"
  ON "AlertPreference" ("accountId");
