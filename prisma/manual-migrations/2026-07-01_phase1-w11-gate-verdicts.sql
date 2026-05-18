-- Phase 1 W11: per-day operator-gate verdicts. Replaces relying on
-- JobRun.status (which can be green while individual sub-gates fail).
-- See plan docs/superpowers/plans/2026-05-17-ml-phase1-w9-12-growth.md Task 12.

CREATE TABLE IF NOT EXISTS "OperatorGateDailyVerdict" (
  "id"             TEXT PRIMARY KEY,
  "verdictDate"    DATE NOT NULL,
  "gateName"       TEXT NOT NULL,
  "passed"         BOOLEAN NOT NULL,
  "detail"         TEXT,
  "computedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "OperatorGateDailyVerdict_date_gate_key"
  ON "OperatorGateDailyVerdict" ("verdictDate", "gateName");
