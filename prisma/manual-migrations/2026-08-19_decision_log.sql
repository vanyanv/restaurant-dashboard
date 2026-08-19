-- DecisionLog: what the owner decided, and the counterfactual to judge it by.
--
-- The Decisions page held "Mark done" in React state. It forgot on refresh, and
-- because nothing was ever recorded, the system could not learn whether any
-- recommendation was worth making. Every "+$170/wk" on that page is a heuristic
-- with no measured error, and it stays that way until decisions and outcomes
-- are stored side by side.
--
-- `frozenForecast` is the load-bearing column. ForecastDailyRevenue stamps
-- generatedAt, so the forecast produced BEFORE a decision is, by construction,
-- an estimate of what would have happened without it. Freezing it at commit
-- time yields an interrupted-time-series read with no experiment design, no
-- holdout stores and no new collection. Shape:
--   [{ "date": "YYYY-MM-DD", "predicted": n, "p10": n|null, "p90": n|null }]
--
-- The opportunity reference is (type, title), not a foreign key:
-- GrowthOpportunity rows are regenerated nightly with fresh ids, so an FK would
-- dangle by morning.
CREATE TYPE "DecisionState" AS ENUM ('COMMITTED', 'DISMISSED');

CREATE TABLE IF NOT EXISTS "DecisionLog" (
  "id"                        TEXT PRIMARY KEY,
  "storeId"                   TEXT NOT NULL,
  "opportunityType"           "OpportunityType" NOT NULL,
  "opportunityTitle"          TEXT NOT NULL,
  "opportunityAsOf"           DATE NOT NULL,
  "state"                     "DecisionState" NOT NULL,
  "dismissReason"             TEXT,
  "decidedByUserId"           TEXT NOT NULL,
  "decidedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL,
  "predictedImpactUsdPerWeek" DOUBLE PRECISION NOT NULL,
  "predictedImpactP10"        DOUBLE PRECISION,
  "predictedImpactP90"        DOUBLE PRECISION,
  "frozenForecast"            JSONB,
  CONSTRAINT "DecisionLog_storeId_fkey" FOREIGN KEY ("storeId")
    REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DecisionLog_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId")
    REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- One live decision per opportunity identity; re-deciding updates in place.
CREATE UNIQUE INDEX IF NOT EXISTS "DecisionLog_storeId_opportunityType_opportunityTitle_key"
  ON "DecisionLog" ("storeId", "opportunityType", "opportunityTitle");

CREATE INDEX IF NOT EXISTS "DecisionLog_storeId_decidedAt_idx"
  ON "DecisionLog" ("storeId", "decidedAt" DESC);
