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
from ml.evaluation.nightly_integration import (
    run_consistency_check,
    run_evaluation_pass,
)
from ml.evaluation.promotion import (
    PromotionDecision,
    decide_promotion,
    select_with_gate,
    should_promote_enriched,
)
from ml.evaluation.reconcile import reconcile_past_forecasts
from ml.features.menu_item import load_top_items
from ml.features.revenue import list_active_store_ids, load_daily_revenue
from ml.features.hourly_orders import load_hourly_orders
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


def _select_result(baseline, enriched, *, target: str, store_id: str):
    """Thin wrapper around `select_with_gate`. Returns (chosen, label, reason).

    For daily targets (REVENUE / MENU_ITEM) the model_history is the
    daily-revenue series; for hourly (BUSY_HOURS) it's the hourly-orders
    series. We load lazily here because the caller already issued a
    training pass against the same window.
    """
    if target == "BUSY_HOURS":
        history = load_hourly_orders(store_id)[["date", "hour", "orders"]]
    else:
        history = load_daily_revenue(store_id)[["date", "revenue"]]
    return select_with_gate(baseline, enriched, target=target, model_history=history)


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
        result, gate, gate_reason = _select_result(
            baseline, enriched, target="REVENUE", store_id=store_id
        )
        selected_version = _version_with_flavor(model_version, result)
        _set_run_model_version(run_id, selected_version)
        rows = forecast_revenue(store_id, result, horizon_days=REVENUE_HORIZON_DAYS)
        written = _write_revenue_forecasts(store_id, selected_version, rows)
        warning = None
        if gate != "promoted":
            warning = f"{gate}: {gate_reason}"

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
    MlTrainingRun row keyed on target=MENU_ITEM.

    Promotion-gate note (Phase 1): MENU_ITEM is INTENTIONALLY outside the
    seasonal-naive promotion gate that `_select_result` applies to REVENUE
    and BUSY_HOURS. The per-SKU `train_menu_item` only produces ONE flavor
    (no baseline-vs-enriched pair), so there's nothing to gate between.
    Each SKU's model is published as-is; promotion gating for menu items
    is deferred to a future phase that introduces a comparable baseline.
    See `decide_promotion` docstring in ml.evaluation.promotion for the
    list of targets the gate currently applies to.
    """
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
        result, gate, gate_reason = _select_result(
            baseline, enriched, target="BUSY_HOURS", store_id=store_id
        )
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
            gate_warning = f"{gate}: {gate_reason}"
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

        # Evaluator + consistency checks run AFTER reconciliation so the
        # trailing 28-day window has the latest actuals filled in.
        try:
            with connect() as conn:
                run_evaluation_pass(conn, store_id, dt.date.today())
                run_consistency_check(conn, store_id, dt.date.today())
            print({"phase": "EVALUATE", "store_id": store_id, "ok": True})
        except Exception as exc:  # pylint: disable=broad-except
            print({
                "phase": "EVALUATE",
                "store_id": store_id,
                "ok": False,
                "reason": str(exc),
            })
            failures += 1
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
