-- Uncertainty on elasticity, and on the dollar impacts derived from it.
--
-- MenuItemElasticity stored the coefficient, its R² and its sample size but not
-- the coefficient's standard error — the one number that says how far to trust
-- it. ml/growth/impact.py then multiplied that elasticity by units, margin and
-- Δprice and reported a single figure, so a fit on 41 noisy days produced a
-- recommendation indistinguishable from one on 400 clean ones. That is the bug
-- class behind "+$10,839/wk" for a slow-moving combo.
--
-- The standard error falls out of the same design matrix
-- (se = sqrt(σ²·diag((XᵀX)⁻¹))) and is propagated through the impact formula by
-- Monte Carlo in ml/growth/uncertainty.py.
--
-- impactP25 is what the Decisions ledger sorts on: a wide, speculative $900
-- should not outrank a tight, dependable $700.
--
-- All nullable and additive. Rows written before this carry no interval, and
-- the UI shows a bare point estimate for them, which is what it did for
-- everything until now.
ALTER TABLE "MenuItemElasticity"
  ADD COLUMN IF NOT EXISTS "elasticityStdErr" DOUBLE PRECISION;

ALTER TABLE "GrowthOpportunity"
  ADD COLUMN IF NOT EXISTS "impactP10" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "impactP25" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "impactP90" DOUBLE PRECISION;
