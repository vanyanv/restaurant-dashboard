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
import time
import traceback

from ml.anomaly.zscore import (
    detect_menu_item_anomalies,
    detect_revenue_anomalies,
    write_anomalies,
)
from ml.elasticity.menu_item import run_for_store as run_elasticity_for_store
from ml.db import connect, cuid_like
from ml.features.menu_item import load_top_items
from ml.features.revenue import list_active_store_ids
from ml.models.menu_item import forecast as forecast_menu_item
from ml.models.menu_item import train as train_menu_item
from ml.models.hourly_orders import forecast as forecast_hourly_orders
from ml.models.hourly_orders import train as train_hourly_orders
from ml.models.revenue import forecast as forecast_revenue
from ml.models.revenue import train as train_revenue


REVENUE_HORIZON_DAYS = 14
MENU_ITEM_HORIZON_DAYS = 7
BUSY_HOURS_HORIZON_DAYS = 14
TOP_N_ITEMS_PER_STORE = 30
MODEL_TYPE = "xgboost"
ENRICHED_FLAVOR = "weather-events"


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


def _set_run_model_version(run_id: str, model_version: str) -> None:
    sql = 'UPDATE "MlTrainingRun" SET "modelVersion" = %s WHERE id = %s'
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (model_version, run_id))


def should_promote_enriched(baseline, enriched) -> bool:
    """Accuracy gate for weather/event models.

    Promote when enriched MAPE improves by >=3% relative, or when MAE improves
    by >=5% without material MAPE regression (<=0.5% relative worse).
    """
    if baseline is None or enriched is None:
        return False
    if baseline.mape is None or enriched.mape is None:
        return False
    if baseline.mape > 0 and enriched.mape <= baseline.mape * 0.97:
        return True
    if baseline.mae is not None and enriched.mae is not None and baseline.mae > 0:
        mae_improved = enriched.mae <= baseline.mae * 0.95
        mape_not_worse = enriched.mape <= baseline.mape * 1.005
        return bool(mae_improved and mape_not_worse)
    return False


def _select_result(baseline, enriched):
    if should_promote_enriched(baseline, enriched):
        return enriched, "promoted"
    if enriched is None:
        return baseline, "enriched_skipped"
    return baseline, "baseline_won"


def _version_with_flavor(model_version: str, result) -> str:
    flavor = getattr(result, "flavor", "baseline") or "baseline"
    return f"{model_version}-{flavor}"


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
        baseline = train_revenue(store_id, enriched=False)
        if baseline is None:
            _close_run(
                run_id,
                mape=None,
                mae=None,
                sample_size=None,
                status="FAILED",
                error="insufficient_history",
            )
            return {"store_id": store_id, "ok": False, "reason": "insufficient_history"}

        enriched = train_revenue(store_id, enriched=True)
        result, gate = _select_result(baseline, enriched)
        selected_version = _version_with_flavor(model_version, result)
        _set_run_model_version(run_id, selected_version)
        rows = forecast_revenue(store_id, result, horizon_days=REVENUE_HORIZON_DAYS)
        written = _write_revenue_forecasts(store_id, selected_version, rows)
        warning = None
        if gate != "promoted":
            warning = (
                f"{gate}; enriched_mape={getattr(enriched, 'mape', None)}; "
                f"baseline_mape={baseline.mape}"
            )

        _close_run(
            run_id,
            mape=result.mape,
            mae=result.mae,
            sample_size=result.sample_size,
            status="SUCCEEDED",
            error=warning,
        )
        return {
            "store_id": store_id,
            "ok": True,
            "rows_written": written,
            "mape": result.mape,
            "mae": result.mae,
            "model_flavor": result.flavor,
            "selection": gate,
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


def _write_menu_item_forecasts(
    store_id: str, item_name: str, model_version: str, rows: list
) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO "ForecastMenuItem"
            (id, "storeId", "otterItemSkuId", "forecastDate",
             "predictedQty", p10, p90, "modelVersion")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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
                        item_name,
                        r.forecast_date,
                        r.predicted_qty,
                        r.p10,
                        r.p90,
                        model_version,
                    ),
                )
                written += 1
    return written


def run_menu_items_for_store(store_id: str, model_version: str) -> dict:
    """Train + forecast top-N menu items at one store under a single
    MlTrainingRun row keyed on target=MENU_ITEM."""
    run_id = _open_run("MENU_ITEM", store_id, model_version)
    items = load_top_items(store_id, top_n=TOP_N_ITEMS_PER_STORE)
    if not items:
        _close_run(
            run_id,
            mape=None,
            mae=None,
            sample_size=None,
            status="FAILED",
            error="no_items_in_lookback",
        )
        return {"store_id": store_id, "ok": False, "reason": "no_items_in_lookback"}

    mapes: list[float] = []
    sample_sizes: list[int] = []
    written_total = 0
    failed_items: list[str] = []
    for item_name in items:
        try:
            result = train_menu_item(store_id, item_name)
            if result is None:
                failed_items.append(item_name)
                continue
            rows = forecast_menu_item(
                store_id, item_name, result, horizon_days=MENU_ITEM_HORIZON_DAYS
            )
            written_total += _write_menu_item_forecasts(
                store_id, item_name, model_version, rows
            )
            mapes.append(result.mape)
            sample_sizes.append(result.sample_size)
        except Exception as exc:  # pylint: disable=broad-except
            failed_items.append(item_name)
            print(f"menu_item {store_id}/{item_name} failed: {exc}")

    if not mapes:
        _close_run(
            run_id,
            mape=None,
            mae=None,
            sample_size=None,
            status="FAILED",
            error=f"all_items_failed ({len(failed_items)})",
        )
        return {
            "store_id": store_id,
            "ok": False,
            "reason": "all_items_failed",
            "failed_count": len(failed_items),
        }

    avg_mape = sum(mapes) / len(mapes)
    total_samples = sum(sample_sizes)
    _close_run(
        run_id,
        mape=avg_mape,
        mae=None,
        sample_size=total_samples,
        status="SUCCEEDED",
    )
    return {
        "store_id": store_id,
        "ok": True,
        "items_trained": len(mapes),
        "items_failed": len(failed_items),
        "rows_written": written_total,
        "avg_mape": avg_mape,
    }


def _write_hourly_order_forecasts(store_id: str, model_version: str, rows: list) -> int:
    if not rows:
        return 0
    sql = """
        INSERT INTO "ForecastHourlyOrders"
            (id, "storeId", "forecastDate", "hourBucket",
             "predictedOrders", p10, p90, "modelVersion")
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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
                        r.hour_bucket,
                        r.predicted_orders,
                        r.p10,
                        r.p90,
                        model_version,
                    ),
                )
                written += 1
    return written


def run_busy_hours_for_store(store_id: str, model_version: str) -> dict:
    start = time.perf_counter()
    run_id = _open_run("BUSY_HOURS", store_id, model_version)
    try:
        baseline = train_hourly_orders(store_id, enriched=False)
        if baseline is None:
            _close_run(
                run_id,
                mape=None,
                mae=None,
                sample_size=None,
                status="FAILED",
                error="insufficient_hourly_history",
            )
            return {
                "store_id": store_id,
                "ok": False,
                "reason": "insufficient_hourly_history",
                "duration_ms": round((time.perf_counter() - start) * 1000),
            }

        enriched = train_hourly_orders(store_id, enriched=True)
        result, gate = _select_result(baseline, enriched)
        selected_version = _version_with_flavor(model_version, result)
        _set_run_model_version(run_id, selected_version)
        rows = forecast_hourly_orders(
            store_id, result, horizon_days=BUSY_HOURS_HORIZON_DAYS
        )
        written = _write_hourly_order_forecasts(store_id, selected_version, rows)
        warning = None
        if result.harri_coverage < 0.6:
            warning = f"low_harri_coverage:{result.harri_coverage:.2f}"
        if gate != "promoted":
            gate_warning = (
                f"{gate}; enriched_mape={getattr(enriched, 'mape', None)}; "
                f"baseline_mape={baseline.mape}"
            )
            warning = f"{warning}; {gate_warning}" if warning else gate_warning

        _close_run(
            run_id,
            mape=result.mape,
            mae=result.mae,
            sample_size=result.sample_size,
            status="SUCCEEDED",
            error=warning,
        )
        return {
            "store_id": store_id,
            "ok": True,
            "rows_written": written,
            "mape": result.mape,
            "mae": result.mae,
            "sample_size": result.sample_size,
            "harri_coverage": result.harri_coverage,
            "model_flavor": result.flavor,
            "selection": gate,
            "warning": warning,
            "duration_ms": round((time.perf_counter() - start) * 1000),
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
        return {
            "store_id": store_id,
            "ok": False,
            "reason": str(exc),
            "duration_ms": round((time.perf_counter() - start) * 1000),
        }


def reconcile_past_forecasts(store_id: str) -> dict:
    """Backfill actuals on past forecast rows for one store.

    Idempotent — `WHERE "reconciledAt" IS NULL` ensures re-runs only touch
    rows that still lack actuals. Mirrors `scripts/backfill-reconciliation.ts`
    so the nightly pipeline keeps reconciliation current after each forecast
    write. See that script for column-mapping rationale.

    Tables:
      ForecastDailyRevenue   <- SUM(OtterDailySummary.fp/tpNetSales) per (store, date)
      ForecastHourlyOrders   <- OtterHourlySummary.orderCount per (store, date, hour);
                                closed hours on a day with any Otter coverage = 0
      ForecastMenuItem       <- SUM(OtterMenuItem.fp/tpQuantitySold) per
                                (store, date, itemName) where isModifier=false
    """
    counts = {"revenue": 0, "hourly_orders": 0, "menu_item": 0}
    with connect() as conn, conn.cursor() as cur:
        # Daily revenue. Skip dates with no OtterDailySummary rows.
        cur.execute(
            '''
            UPDATE "ForecastDailyRevenue" f
            SET "actualRevenue" = agg.actual,
                "errorPct" = CASE
                    WHEN agg.actual = 0 THEN NULL
                    ELSE ((f."predictedRevenue" - agg.actual) / agg.actual) * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT "storeId", date,
                       SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0)) AS actual
                FROM "OtterDailySummary"
                WHERE "storeId" = %s
                GROUP BY "storeId", date
            ) agg
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND f."hourBucket" = 0
              AND f."storeId" = agg."storeId"
              AND f."forecastDate" = agg.date
            ''',
            (store_id, store_id),
        )
        counts["revenue"] = cur.rowcount

        # Hourly orders. Treat missing hours on covered dates as zero.
        # Two-step: first reconcile real-row matches; then zero-fill missing
        # hours on dates that have any Otter coverage at all.
        cur.execute(
            '''
            UPDATE "ForecastHourlyOrders" f
            SET "actualOrders" = o."orderCount",
                "errorPct" = CASE
                    WHEN o."orderCount" = 0 THEN NULL
                    ELSE ((f."predictedOrders" - o."orderCount") / o."orderCount") * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM "OtterHourlySummary" o
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND o."storeId" = f."storeId"
              AND o.date = f."forecastDate"
              AND o.hour = f."hourBucket"
            ''',
            (store_id,),
        )
        hourly_matched = cur.rowcount
        cur.execute(
            '''
            UPDATE "ForecastHourlyOrders" f
            SET "actualOrders" = 0,
                "errorPct" = NULL,
                "reconciledAt" = CURRENT_TIMESTAMP
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND EXISTS (
                  SELECT 1 FROM "OtterHourlySummary" o
                  WHERE o."storeId" = f."storeId"
                    AND o.date = f."forecastDate"
              )
            ''',
            (store_id,),
        )
        counts["hourly_orders"] = hourly_matched + cur.rowcount

        # Menu items. Skip rows where the item has no OtterMenuItem coverage on
        # that date (cannot distinguish "we didn't sell it" from "no sync").
        cur.execute(
            '''
            UPDATE "ForecastMenuItem" f
            SET "actualQty" = agg.actual,
                "errorPct" = CASE
                    WHEN agg.actual = 0 THEN NULL
                    ELSE ((f."predictedQty" - agg.actual) / agg.actual) * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT "storeId", date, "itemName",
                       SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS actual
                FROM "OtterMenuItem"
                WHERE "storeId" = %s
                  AND "isModifier" = false
                GROUP BY "storeId", date, "itemName"
            ) agg
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND f."storeId" = agg."storeId"
              AND f."forecastDate" = agg.date
              AND f."otterItemSkuId" = agg."itemName"
            ''',
            (store_id, store_id),
        )
        counts["menu_item"] = cur.rowcount

    return {"store_id": store_id, "ok": True, **counts}


def run_anomaly_detection_for_store(store_id: str) -> dict:
    """Score yesterday's revenue + top-N item quantities against the
    trailing 28-day distribution. Flag |z| >= 3 with method ZSCORE.

    Anomaly detection has no MlTrainingRun row — it's a thresholding
    pass over the data, not a training job. Failures bubble up and
    stop the per-store loop iteration.
    """
    try:
        revenue_anomalies = detect_revenue_anomalies(store_id)
        item_anomalies = detect_menu_item_anomalies(
            store_id, load_top_items(store_id, top_n=TOP_N_ITEMS_PER_STORE)
        )
        all_anomalies = revenue_anomalies + item_anomalies
        written = write_anomalies(store_id, all_anomalies)
        return {
            "store_id": store_id,
            "ok": True,
            "revenue_count": len(revenue_anomalies),
            "menu_item_count": len(item_anomalies),
            "rows_written": written,
        }
    except Exception as exc:  # pylint: disable=broad-except
        return {"store_id": store_id, "ok": False, "reason": str(exc)}


def main() -> int:
    model_version = _model_version()
    store_ids = list_active_store_ids()
    if not store_ids:
        print("no active stores")
        return 0

    failures = 0
    for store_id in store_ids:
        revenue_result = run_revenue_for_store(store_id, model_version)
        print({"target": "REVENUE", **revenue_result})
        if not revenue_result.get("ok"):
            failures += 1

        menu_result = run_menu_items_for_store(store_id, model_version)
        print({"target": "MENU_ITEM", **menu_result})
        if not menu_result.get("ok"):
            failures += 1

        busy_hours_result = run_busy_hours_for_store(store_id, model_version)
        print({"target": "BUSY_HOURS", **busy_hours_result})
        if not busy_hours_result.get("ok"):
            failures += 1

        anomaly_result = run_anomaly_detection_for_store(store_id)
        print({"phase": "ANOMALY", **anomaly_result})
        if not anomaly_result.get("ok"):
            failures += 1

        elasticity_result = run_elasticity_for_store(store_id)
        print({"phase": "ELASTICITY", **elasticity_result})
        if not elasticity_result.get("ok"):
            failures += 1

        try:
            reconcile_result = reconcile_past_forecasts(store_id)
            print({"phase": "RECONCILE", **reconcile_result})
        except Exception as exc:  # pylint: disable=broad-except
            print({
                "phase": "RECONCILE",
                "store_id": store_id,
                "ok": False,
                "reason": str(exc),
            })
            failures += 1
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
