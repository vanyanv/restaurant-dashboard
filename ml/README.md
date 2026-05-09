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

## Adding a new target

1. Build a feature module in `ml/features/<target>.py`.
2. Build a model module in `ml/models/<target>.py` exporting `train()` +
   `forecast()`.
3. Wire it into `ml/run_nightly.py` alongside `run_revenue_for_store`.
4. Add a `MlTarget` enum value if needed and a forecast table in the
   Prisma schema. Document it back here.
