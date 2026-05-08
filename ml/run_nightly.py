"""Nightly entry point — orchestrates training + forecasting for every
active store and persists the results to Postgres.

Architectural rules (Phase 5 plan):
  - Do not train models inside Vercel functions.
  - Do not retrain per request.
  - Forecasts are computed in batch off-platform; the dashboard reads
    precomputed predictions from Postgres.

Workflow:
  1. Open an MlTrainingRun per (target, store) with status RUNNING.
  2. Train + forecast.
  3. Insert ForecastDailyRevenue rows for the next 14 days.
  4. Close the run with mape/mae/sampleSize and SUCCEEDED status.
  5. On exception, close the run with FAILED + errorMessage and continue.
"""
from __future__ import annotations

import datetime as dt
import os
import sys
import traceback

from ml.db import connect, cuid_like
from ml.features.revenue import list_active_store_ids
from ml.models.revenue import forecast as forecast_revenue
from ml.models.revenue import train as train_revenue


HORIZON_DAYS = 14
MODEL_TYPE = "xgboost"


def _model_version() -> str:
    sha = os.environ.get("GITHUB_SHA", "local")[:8]
    stamp = dt.datetime.utcnow().strftime("%Y%m%d-%H%M")
    return f"{MODEL_TYPE}-{sha}-{stamp}"


def _open_run(target: str, scope: str, model_version: str) -> str:
    run_id = cuid_like()
    sql = """
        INSERT INTO "MlTrainingRun" (id, "modelType", target, scope, "modelVersion", status)
        VALUES (%s, %s, %s, %s, %s, 'RUNNING')
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (run_id, MODEL_TYPE, target, scope, model_version))
    return run_id


def _close_run(run_id: str, *, mape: float | None, mae: float | None,
               sample_size: int | None, status: str, error: str | None = None) -> None:
    sql = """
        UPDATE "MlTrainingRun"
        SET "completedAt" = CURRENT_TIMESTAMP,
            mape = %s,
            mae = %s,
            "sampleSize" = %s,
            status = %s::"MlTrainingStatus",
            "errorMessage" = %s
        WHERE id = %s
    """
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (mape, mae, sample_size, status, error, run_id))


def _write_revenue_forecasts(store_id: str, model_version: str, rows: list) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO "ForecastDailyRevenue"
            (id, "storeId", "forecastDate", "hourBucket",
             "predictedRevenue", p10, p90, "modelVersion")
        VALUES (%s, %s, %s, 0, %s, %s, %s, %s)
    """
    written = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    sql,
                    (
                        cuid_like(),
                        store_id,
                        r.forecast_date,
                        r.predicted_revenue,
                        r.p10,
                        r.p90,
                        model_version,
                    ),
                )
                written += 1
    return written


def run_revenue_for_store(store_id: str, model_version: str) -> dict:
    run_id = _open_run("REVENUE", store_id, model_version)
    try:
        result = train_revenue(store_id)
        if result is None:
            _close_run(
                run_id,
                mape=None,
                mae=None,
                sample_size=None,
                status="FAILED",
                error="insufficient_history",
            )
            return {"store_id": store_id, "ok": False, "reason": "insufficient_history"}

        rows = forecast_revenue(store_id, result, horizon_days=HORIZON_DAYS)
        written = _write_revenue_forecasts(store_id, model_version, rows)

        _close_run(
            run_id,
            mape=result.mape,
            mae=result.mae,
            sample_size=result.sample_size,
            status="SUCCEEDED",
        )
        return {
            "store_id": store_id,
            "ok": True,
            "rows_written": written,
            "mape": result.mape,
            "mae": result.mae,
        }
    except Exception as exc:  # pylint: disable=broad-except
        tb = traceback.format_exc()
        _close_run(
            run_id,
            mape=None,
            mae=None,
            sample_size=None,
            status="FAILED",
            error=f"{type(exc).__name__}: {exc}\n{tb[-500:]}",
        )
        return {"store_id": store_id, "ok": False, "reason": str(exc)}


def main() -> int:
    model_version = _model_version()
    store_ids = list_active_store_ids()
    if not store_ids:
        print("no active stores")
        return 0

    failures = 0
    for store_id in store_ids:
        result = run_revenue_for_store(store_id, model_version)
        print(result)
        if not result.get("ok"):
            failures += 1
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
