-- TreeSHAP attribution per daily-revenue forecast row.
--
-- XGBoost computes exact per-feature contributions as a by-product
-- (`pred_contribs=True`), and nothing has ever read them. The Decisions page
-- rendered a forecast plus three grey confidence dots; this is what lets the
-- day drawer say "Saturday +$2,100, the Bowl show +$1,180" instead.
--
-- Shape: {"base": number, "groups": [{"label": string, "value": number}]},
-- summing to predictedRevenue. Grouped in ml/models/attribution.py — an owner
-- has no use for lag_7 weighed against roll_28.
--
-- Nullable and additive: rows written before this, and any row whose booster
-- declines to produce contributions, simply carry no waterfall.
ALTER TABLE "ForecastDailyRevenue"
  ADD COLUMN IF NOT EXISTS "attribution" JSONB;
