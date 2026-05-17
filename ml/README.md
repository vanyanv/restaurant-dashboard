# ML Pipeline

Phase 5 forecasting + anomaly detection. Runs as a nightly batch job on
GitHub Actions; the Next.js dashboard reads the precomputed predictions
from Postgres. **Never train inside Vercel functions.**

## Layout

```
ml/
├── db.py               connection + cuid-like id helper
├── features/
│   └── revenue.py      daily-revenue feature engineering
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
