# ML Pipeline

Phase 5 forecasting + anomaly detection. Runs as a nightly batch job on
GitHub Actions; the Next.js dashboard reads the precomputed predictions
from Postgres. **Never train inside Vercel functions.**

## Layout

```
ml/
├── db.py               connection + cuid-like id helper
├── backtest.py         rolling-origin backtest CLI (per-horizon scores)
├── features/
│   ├── revenue.py      daily-revenue feature engineering
│   ├── holidays.py     US holidays incl. the moving ones + shoulders
│   └── completeness.py trailing-day trim + evidence-based gap filling
├── anomaly/
│   ├── interval.py     actual vs that day's own P10/P90 (preferred)
│   └── zscore.py       pooled 28-day z (fallback, no forecast yet)
├── models/
│   └── revenue.py      XGBoost trainer + 14-day forecaster
├── run_nightly.py      orchestrator (one MlTrainingRun per (target, store))
├── requirements.txt    pinned deps for reproducible CI runs
└── README.md
```

## Local run

```bash
# pin DATABASE_URL in .env.local (already there for the Next.js app)
python -m venv .venv-ml
source .venv-ml/bin/activate
pip install -r ml/requirements.txt
python -m ml.run_nightly
```

The script prints one JSON-ish dict per store. It writes:

- `MlTrainingRun` rows with mape / mae / sampleSize per (target, store)
- `ForecastDailyRevenue` rows for the next 14 days (one row per day per store)

## CI

`.github/workflows/ml-nightly.yml` runs on cron `0 6 * * *` UTC (02:00 ET).
Sets `DATABASE_URL` from the `DATABASE_URL` repo secret. Logs go to the
workflow artifact `ml-nightly-log-<run_id>` for 14 days.

`.github/workflows/ml-operator-gate-check.yml` runs the Phase 1 validation
discipline check each morning on cron `0 14 * * *` UTC:

```bash
ml/.venv/bin/python -m ml.evaluation.operator_gate_check
```

The check writes `JobRun` rows under `ml.operator-gate-check`; the ML
monitoring tab shows the latest run, gate signals, and the 7-PASS streak.

## Backtesting

**Every model change gets backtested before it ships.** The harness replays the
real `train()` -> `forecast()` path with history truncated at each cutoff, so
nothing a fold is scored on was available to it:

```bash
ml/.venv/bin/python -m ml.backtest --store <id> --cutoffs 10 --horizon 14
ml/.venv/bin/python -m ml.backtest --store <id> --cutoffs 10 --compare  # + enriched
```

Output is JSON: a summary plus one row per horizon day with WAPE, MAPE, signed
relative bias, 80% interval coverage and sample size. Score **per horizon** —
pooling them hides the thing that matters, since a model can be excellent one
day out and useless at fourteen, and the fourteen-day number is what stock gets
ordered against.

`train()` and `forecast()` both accept `history=` for this. Never monkeypatch
the loaders to simulate a cutoff.

## Prediction intervals

`p10`/`p90` come from conformalized quantile regression (`ml/evaluation/cqr.py`)
— the conditional 10th and 90th quantiles fit directly, then conformalised, so
the band varies by day and may be asymmetric. Set
`ml.run_nightly.REVENUE_INTERVAL_METHOD = "conformal"` to revert to the
symmetric single-width predecessor; nothing else changes.

Backtested on Hollywood, 40 folds x 14-day horizon (n=560 per model). The point
forecast is untouched by the choice — WAPE 9.48% either way — so the comparison
is purely about the band:

| | symmetric | CQR |
|---|---|---|
| mean \|coverage − 80%\| | 9.3pp | **6.2pp** |
| mean coverage | 89.3% | **84.8%** |
| mean band width | 45.5% | 46.9% |

Judge an interval on **both** coverage and width. `ml.backtest` reports
`mean_rel_width` next to `coverage80` for exactly this reason: a band covering
100% of days may simply be too wide to act on, which is what horizons 12-14
show. That residual over-coverage is `HORIZON_WIDENING_PER_DAY`, not the band
shape — see F10.

## Missing days vs closed days

`load_daily_revenue` returns a gap-free calendar, but it does not invent
observations. A date with no sales row is `$0` only when hourly coverage proves
the day was watched to closing; otherwise it is `NaN` and the training splits
drop it. `.fillna(0.0)` used to make a failed sync indistinguishable from a
holiday closure, and that zero became both a training target and ninety days of
poisoned lag/rolling features.

## Anomaly detection

Revenue anomalies come from `ml/anomaly/interval.py`: an actual outside that
day's own calibrated P10/P90. Seasonality is handled by the forecast rather than
by a pooled dispersion estimate, any window can be rescored so a skipped nightly
backfills itself, and the output is a dollar residual against an expected value.

`ml/anomaly/zscore.py` remains the fallback for stores with no reconciled
forecasts yet (warming-up, or a first run), and still handles menu items, which
have no per-SKU interval. Rows written by the interval detector carry
`method = 'PREDICTION_INTERVAL'` and a null `zScore` — see
`prisma/manual-migrations/2026-08-21_anomaly_method_prediction_interval.sql`,
which must be applied before that path can write.

## Adding a new target

1. Build a feature module in `ml/features/<target>.py`.
2. Build a model module in `ml/models/<target>.py` exporting `train()` +
   `forecast()`.
3. Wire it into `ml/run_nightly.py` alongside `run_revenue_for_store`.
4. Add a `MlTarget` enum value if needed and a forecast table in the
   Prisma schema. Document it back here.

## Lifecycle stages (W5)

Stores progress `pre_open → warming_up → ready`:

- `pre_open` — physically not open. Nightly pipeline skips entirely;
  dashboard shows "Opening soon".
- `warming_up` — open but native model untrustworthy. Nightly emits
  transfer-source forecasts derived from Hollywood
  (`ml/transfer/hollywood_prior.py`), trains native in parallel, and
  refuses to promote until native WAPE beats transfer WAPE by ≥5% with
  `sampleSize ≥ 60`.
- `ready` — native model in production. Participates in all phases.

Promotion is automatic via `ml/lifecycle.py::should_promote_to_ready`; the
only manual flip is `pre_open → warming_up`, done by ops when the store
physically opens. See `docs/superpowers/specs/2026-05-17-ml-phase1-weeks5-12-design.md`
§1 for the full design and `docs/superpowers/plans/2026-05-17-ml-phase1-w5-onboarding.md`
for the implementation log.

## Hierarchical reconciliation (W6-8)

The nightly pipeline writes reconciled point estimates back to the existing
forecast tables (`reconciledRevenue` / `reconciledP10` / `reconciledP90` /
`reconciledQty`) using Nixtla `MinTrace(method='mint_shrink')` — falls back
to `ols` automatically when historical actuals are too sparse for the
shrinkage covariance estimator. The dashboard reads reconciled values by
default; flip `ML_USE_RECONCILED=false` in Vercel to revert to unreconciled
reads (reconciliation continues to write columns; only the read path
changes — full rollback in seconds, no redeploy).

Health is tracked in `MlReconciliationDaily` (one row per store-day, pre/post
discrepancy percentiles). The gate
`python -m ml.evaluation.reconciliation_gate_check` exits 0 if
`postPctDiscrepancyMedian ≤ 15%` for the trailing 7 days.

When GLN/VNYS reach `ready` (post-W5), the multi-store hierarchy
(`ml/reconciliation/hierarchy.py::build_multi_store_hierarchy`) replaces the
single-store builder in `run_hierarchical_reconciliation_for_store`. The
chain-sum invariant is pinned at
`ml/tests/test_hierarchy.py::test_multi_store_minTrace_preserves_chain_sum`.

## Growth opportunities + quality panel (W9-12)

The nightly pipeline runs five generators (`ml/growth/generators/*`) per
ready store and upserts results into `GrowthOpportunity`. The
`/dashboard/intelligence/opportunities` page reads the latest rows;
`/dashboard/intelligence/quality` shows accuracy / reconciliation / lifecycle /
gate-streak in four `.inv-panel` sections. See spec §3 and the W9-12 plan.

To add a sixth opportunity type in Phase 2: extend the `OpportunityType` enum
(both Prisma and `src/types/growth.ts`), drop a new generator file under
`ml/growth/generators/`, and register it in `ml/growth/generators/__init__.py`.
The Phase 2 deferred list lives as a comment in `src/types/growth.ts`:
launch_analogue, lost_sales, weak_promo.
