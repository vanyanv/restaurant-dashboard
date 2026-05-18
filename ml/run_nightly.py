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
    transfer_forecast_wape,
)
from ml.evaluation.reconcile import reconcile_past_forecasts
from ml.features.menu_item import load_top_items
from ml.features.revenue import (
    list_active_store_ids,
    list_stores_by_stage,
    load_daily_revenue,
)
from ml.features.hourly_orders import load_hourly_orders
from ml.lifecycle import (
    READY_PROMOTION_MIN_SAMPLE,
    flip_to_ready,
    should_promote_to_ready,
)
from ml.transfer.hollywood_prior import write_transfer_forecasts_for_store
from ml.reconciliation.avg_price import compute_item_avg_prices, AVG_PRICE_FALLBACK
from ml.reconciliation.category_aggregator import aggregate_categories_for_store
from ml.reconciliation.reconcile import reconcile_store_hierarchy
from ml.reconciliation.snapshot import write_reconciliation_snapshot
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


def resolve_hollywood_store_id() -> str | None:
    """Resolve the operational anchor store by name suffix.

    Per project memory `project_store_lifecycle`, Hollywood is the only
    operational store today. The production row's name is
    "Chris N Eddys - Hollywood"; we match on suffix so this works in any
    environment without a hard-coded ID.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT id FROM "Store" '
            'WHERE name ILIKE %s AND "isActive" = true '
            'AND "lifecycleStage" = \'ready\'::"LifecycleStage" LIMIT 1',
            ("%Hollywood",),
        )
        row = cur.fetchone()
    return row[0] if row else None


def _load_store_init_scalar(store_id: str) -> float | None:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "initialTransferScalar" FROM "Store" WHERE id = %s',
            (store_id,),
        )
        row = cur.fetchone()
    return float(row[0]) if row and row[0] is not None else None


def run_transfer_forecasts_for_store(
    store_id: str, hollywood_store_id: str, model_version: str,
) -> dict:
    initial = _load_store_init_scalar(store_id)
    transfer_version = f"transfer-{model_version}"
    with connect() as conn:
        result = write_transfer_forecasts_for_store(
            conn,
            new_store_id=store_id,
            hollywood_store_id=hollywood_store_id,
            model_version=transfer_version,
            initial_scalar=initial,
        )
    return {
        "store_id": store_id,
        "ok": result.ok,
        "rows_written": result.revenue_rows_written,
        "scalar_used": result.scalar_used,
        "warning": result.warning or None,
    }


def maybe_promote_to_ready(store_id: str, native_result: dict) -> dict:
    """Run the warming_up -> ready check after a successful native train.

    Native WAPE comes from the most recent MlForecastEvaluation row for the
    store (REVENUE target). Transfer WAPE comes from
    `transfer_forecast_wape`. The two thresholds (>=5% rel improvement,
    sample_size >= 60) are enforced by `should_promote_to_ready`.
    """
    sample_size = native_result.get("sample_size") or 0
    if sample_size < READY_PROMOTION_MIN_SAMPLE:
        return {"store_id": store_id, "promoted": False, "reason": "insufficient_sample"}

    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                '''
                SELECT wape FROM "MlForecastEvaluation"
                WHERE "storeId" = %s AND target = 'REVENUE'::"MlTarget"
                ORDER BY "computedAt" DESC
                LIMIT 1
                ''',
                (store_id,),
            )
            row = cur.fetchone()
        if not row or row[0] is None:
            return {"store_id": store_id, "promoted": False, "reason": "no_native_wape_row"}
        native_wape = float(row[0])
        transfer_wape = transfer_forecast_wape(conn, store_id=store_id, lookback_days=60)
        if not should_promote_to_ready(
            native_wape=native_wape,
            transfer_wape=transfer_wape,
            sample_size=sample_size,
        ):
            return {
                "store_id": store_id,
                "promoted": False,
                "reason": (
                    f"native_wape={native_wape:.4f} "
                    f"transfer_wape={transfer_wape and round(transfer_wape, 4)} "
                    f"n={sample_size}"
                ),
            }
        flip_to_ready(conn, store_id=store_id)
    return {"store_id": store_id, "promoted": True, "native_wape": native_wape}


HISTORICAL_Y_DF_DAYS = 28
RECONCILIATION_HORIZON_DAYS = 14


def _f(v):
    """Cast Decimal/None to float/None for the forecast_frame tuples."""
    return float(v) if v is not None else None


def _build_forecast_frame(conn, store_id):
    """Assemble the dict reconcile.reconcile_store_hierarchy consumes.

    Pulls latest native ForecastDailyRevenue / ForecastDailyCategory /
    ForecastMenuItem rows for the next 14 days. Returns None if any level
    is empty (caller fails soft).
    """
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("forecastDate")
                   "forecastDate", "predictedRevenue", p10, p90
            FROM "ForecastDailyRevenue"
            WHERE "storeId" = %s
              AND "hourBucket" = 0
              AND "forecastSource" = 'native'
              AND "forecastDate" >= CURRENT_DATE
              AND "forecastDate" <  CURRENT_DATE + %s::INTEGER
            ORDER BY "forecastDate", "generatedAt" DESC
            ''',
            (store_id, RECONCILIATION_HORIZON_DAYS),
        )
        revenue = [(d, float(p), _f(p10), _f(p90)) for d, p, p10, p90 in cur.fetchall()]
    if not revenue:
        return None

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT date, "categoryName", revenue
            FROM "ForecastDailyCategory"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE
              AND date <  CURRENT_DATE + %s::INTEGER
            ORDER BY "categoryName", date
            ''',
            (store_id, RECONCILIATION_HORIZON_DAYS),
        )
        categories: dict[str, list] = {}
        for d, cat, rev in cur.fetchall():
            categories.setdefault(cat, []).append((d, float(rev), None, None))
    if not categories:
        return None

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
                   "otterItemSkuId", "forecastDate", "predictedQty", p10, p90
            FROM "ForecastMenuItem"
            WHERE "storeId" = %s
              AND "forecastSource" = 'native'
              AND "forecastDate" >= CURRENT_DATE
              AND "forecastDate" <  CURRENT_DATE + %s::INTEGER
            ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
            ''',
            (store_id, RECONCILIATION_HORIZON_DAYS),
        )
        items: dict[str, list] = {}
        for item, d, qty, p10, p90 in cur.fetchall():
            items.setdefault(item, []).append((d, float(qty), _f(p10), _f(p90)))
    if not items:
        return None

    prices = compute_item_avg_prices(conn, store_id=store_id, lookback_days=60)

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("itemName") "itemName", category
            FROM "OtterMenuItem"
            WHERE "storeId" = %s AND "isModifier" = false
            ORDER BY "itemName", date DESC
            ''',
            (store_id,),
        )
        item_to_category = dict(cur.fetchall())

    # Restrict to items we have a category for (hierarchy.py needs the mapping).
    filtered_items = {k: v for k, v in items.items() if k in item_to_category}
    if not filtered_items:
        return None

    return {
        "revenue": revenue,
        "categories": categories,
        "items": filtered_items,
        "prices": prices,
        "item_to_category": {k: item_to_category[k] for k in filtered_items},
    }


def _load_historical_y_df(conn, store_id, forecast_frame, days: int):
    """Long-format insample fitted values for mint_shrink (unique_id, ds, y)."""
    import pandas as pd
    prices = forecast_frame["prices"]
    rows = []

    with conn.cursor() as cur:
        # Revenue actuals.
        cur.execute(
            '''
            SELECT "forecastDate", "actualRevenue"
            FROM "ForecastDailyRevenue"
            WHERE "storeId" = %s
              AND "hourBucket" = 0
              AND "forecastSource" = 'native'
              AND "actualRevenue" IS NOT NULL
              AND "forecastDate" >= CURRENT_DATE - %s::INTEGER
              AND "forecastDate" <  CURRENT_DATE
            ORDER BY "forecastDate"
            ''',
            (store_id, days),
        )
        for d, actual in cur.fetchall():
            rows.append({"unique_id": "revenue", "ds": pd.Timestamp(d), "y": float(actual)})

        # Category historical actuals from OtterMenuItem (qty * avg_price).
        cur.execute(
            '''
            SELECT date, category,
                   SUM(("fpQuantitySold" + "tpQuantitySold")) AS qty,
                   AVG(
                     CASE WHEN ("fpQuantitySold" + "tpQuantitySold") > 0
                          THEN ("fpTotalSales" + "tpTotalSales")
                               / ("fpQuantitySold" + "tpQuantitySold")
                     END
                   ) AS avg_price
            FROM "OtterMenuItem"
            WHERE "storeId" = %s
              AND "isModifier" = false
              AND date >= CURRENT_DATE - %s::INTEGER
              AND date <  CURRENT_DATE
            GROUP BY date, category
            ''',
            (store_id, days),
        )
        for d, cat, qty, avg_price in cur.fetchall():
            if avg_price is None or qty is None:
                continue
            rows.append({
                "unique_id": cat, "ds": pd.Timestamp(d),
                "y": float(qty) * float(avg_price),
            })

        # Item actuals (qty * known avg_price).
        cur.execute(
            '''
            SELECT "otterItemSkuId", "forecastDate", "actualQty"
            FROM "ForecastMenuItem"
            WHERE "storeId" = %s
              AND "forecastSource" = 'native'
              AND "actualQty" IS NOT NULL
              AND "forecastDate" >= CURRENT_DATE - %s::INTEGER
              AND "forecastDate" <  CURRENT_DATE
            ORDER BY "otterItemSkuId", "forecastDate"
            ''',
            (store_id, days),
        )
        for item, d, actual_qty in cur.fetchall():
            price = prices.get(item)
            if price is None:
                continue  # No price -> can't put on the revenue scale; skip.
            rows.append({
                "unique_id": item, "ds": pd.Timestamp(d),
                "y": float(actual_qty) * price,
            })

    if not rows:
        return pd.DataFrame(columns=["unique_id", "ds", "y"])
    df = pd.DataFrame(rows)
    known_ids = (
        {"revenue"}
        | set(forecast_frame["categories"].keys())
        | set(forecast_frame["items"].keys())
    )
    return df[df["unique_id"].isin(known_ids)].reset_index(drop=True)


def _compute_pre_post_discrepancies(forecast_frame, use_reconciled: bool) -> list[float]:
    """Per-day signed discrepancy: (revenue − Σ(item_qty × avg_price)) / revenue.

    When `use_reconciled=True`, falls back to raw values if a row hasn't been
    reconciled. For W6-8 this proxy gives the snapshot writer something to
    percentile; the in-memory frame is the same one MinTrace was run against.
    """
    # forecast_frame items value tuples are (date, qty_or_revenue, p10, p90).
    # For the pre snapshot, use the raw qty values directly. For post, the
    # frame doesn't yet contain reconciled values (those land via UPDATEs
    # after the reconciler runs), so the caller-provided indicator is moot
    # here — both pre and post are computed from the same in-memory frame in
    # this W6-8 implementation. The post snapshot is meaningful because by
    # the time we compute it, _write_reconciled has updated the DB; this
    # function reads from forecast_frame, not the DB. Concretely: post
    # discrepancy is approximated as the residual after MinTrace has been
    # run, but we don't re-read it here — instead, we treat the pre/post
    # snapshot as equal in this implementation and rely on the operator to
    # query MlReconciliationDaily once the post-write completes in a future
    # iteration. The plan's exit gate observation will surface this.
    revenue_by_date = {d: pt for d, pt, _, _ in forecast_frame["revenue"]}
    prices = forecast_frame["prices"]
    item_sum_by_date: dict = {}
    for item, series in forecast_frame["items"].items():
        price = prices.get(item, 1.0) or 1.0
        for d, qty, _, _ in series:
            item_sum_by_date[d] = item_sum_by_date.get(d, 0.0) + float(qty) * price
    discrepancies = []
    for d, rev in revenue_by_date.items():
        if rev == 0:
            continue
        item_sum = item_sum_by_date.get(d, 0.0)
        discrepancies.append((rev - item_sum) / rev)
    return discrepancies


def _compute_post_discrepancies_from_db(conn, store_id: str) -> list[float]:
    """Post-snapshot: read reconciled values back from the DB (set by the
    UPDATEs in reconcile._write_reconciled), recompute per-day discrepancy."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT DISTINCT ON ("forecastDate")
                   "forecastDate",
                   COALESCE("reconciledRevenue", "predictedRevenue") AS rev
            FROM "ForecastDailyRevenue"
            WHERE "storeId" = %s
              AND "hourBucket" = 0
              AND "forecastSource" = 'native'
              AND "forecastDate" >= CURRENT_DATE
              AND "forecastDate" <  CURRENT_DATE + %s::INTEGER
            ORDER BY "forecastDate", "generatedAt" DESC
            ''',
            (store_id, RECONCILIATION_HORIZON_DAYS),
        )
        revenue_rows = cur.fetchall()
    if not revenue_rows:
        return []
    revenue_by_date = {d: float(r) for d, r in revenue_rows}

    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT date, "reconciledRevenue", revenue
            FROM "ForecastDailyCategory"
            WHERE "storeId" = %s
              AND date >= CURRENT_DATE
              AND date <  CURRENT_DATE + %s::INTEGER
            ''',
            (store_id, RECONCILIATION_HORIZON_DAYS),
        )
        cat_by_date: dict = {}
        for d, rec, raw in cur.fetchall():
            cat_by_date[d] = cat_by_date.get(d, 0.0) + float(rec if rec is not None else raw)

    discrepancies = []
    for d, rev in revenue_by_date.items():
        if rev == 0:
            continue
        cat_sum = cat_by_date.get(d, 0.0)
        discrepancies.append((rev - cat_sum) / rev)
    return discrepancies


def run_hierarchical_reconciliation_for_store(store_id: str) -> dict:
    """Run category aggregation + MinTrace + snapshot for one ready store.

    Fails soft at every layer.
    """
    today = dt.date.today()
    with connect() as conn:
        agg = aggregate_categories_for_store(conn, store_id=store_id)
        if not agg.ok:
            return {"store_id": store_id, "ok": False, "phase": "category", "warning": agg.warning}

        forecast_frame = _build_forecast_frame(conn, store_id)
        if forecast_frame is None:
            return {"store_id": store_id, "ok": False, "phase": "frame", "warning": "no_forecast_frame"}

        y_df = _load_historical_y_df(conn, store_id, forecast_frame, HISTORICAL_Y_DF_DAYS)
        pre = _compute_pre_post_discrepancies(forecast_frame, use_reconciled=False)

        rec = reconcile_store_hierarchy(
            conn, store_id=store_id, forecast_frame=forecast_frame,
            y_df=y_df, method="mint_shrink",
        )

        if rec.ok:
            post = _compute_post_discrepancies_from_db(conn, store_id)
            try:
                write_reconciliation_snapshot(
                    conn, store_id=store_id, date=today,
                    pre_discrepancies=pre, post_discrepancies=post,
                    method_used=rec.method,
                )
            except Exception as exc:  # pylint: disable=broad-except
                print({"phase": "RECONCILE_HIERARCHICAL", "store_id": store_id,
                       "warning": f"snapshot_failed: {exc}"})
    return {"store_id": store_id, "ok": rec.ok, "rows_written": rec.rows_written,
            "method": rec.method, "warning": rec.warning or None}


def _run_full_pipeline_for_store(store_id: str, model_version: str) -> int:
    """Run the post-W1-4 pipeline for one `ready` store.

    Returns the count of failures. Extracted so the main() loop can run the
    same sequence whether the store is in `ready` or has just been promoted
    from `warming_up` mid-loop.
    """
    failures = 0
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
        print({"phase": "RECONCILE", "store_id": store_id, "ok": False, "reason": str(exc)})
        failures += 1

    # W6-8: hierarchical reconciliation. Non-blocking — partial output is still
    # useful and the read path falls back to raw values when reconciled is null.
    rec_result = run_hierarchical_reconciliation_for_store(store_id)
    print({"phase": "RECONCILE_HIERARCHICAL", **rec_result})

    try:
        with connect() as conn:
            run_evaluation_pass(conn, store_id, dt.date.today())
            run_consistency_check(conn, store_id, dt.date.today())
        print({"phase": "EVALUATE", "store_id": store_id, "ok": True})
    except Exception as exc:  # pylint: disable=broad-except
        print({"phase": "EVALUATE", "store_id": store_id, "ok": False, "reason": str(exc)})
        failures += 1

    return failures


def main() -> int:
    model_version = _model_version()

    pre_open = list_stores_by_stage(stages=("pre_open",))
    warming_up = list_stores_by_stage(stages=("warming_up",))
    ready = list_stores_by_stage(stages=("ready",))

    for store_id in pre_open:
        print({"phase": "LIFECYCLE", "store_id": store_id, "stage": "pre_open", "action": "skipped"})

    hollywood_id = None
    if warming_up:
        hollywood_id = resolve_hollywood_store_id()
        if hollywood_id is None:
            print({"phase": "LIFECYCLE", "warning": "no_hollywood_anchor_skipping_transfers"})

    failures = 0
    for store_id in warming_up:
        if hollywood_id:
            t_result = run_transfer_forecasts_for_store(store_id, hollywood_id, model_version)
            print({"phase": "TRANSFER", **t_result})
            if not t_result.get("ok"):
                failures += 1
        # Also train native so the lifecycle gate has data to evaluate.
        revenue_result = run_revenue_for_store(store_id, model_version)
        print({"target": "REVENUE", **revenue_result})
        if revenue_result.get("ok"):
            promo = maybe_promote_to_ready(store_id, revenue_result)
            print({"phase": "LIFECYCLE", **promo})
        else:
            failures += 1

    for store_id in ready:
        revenue_result = run_revenue_for_store(store_id, model_version)
        print({"target": "REVENUE", **revenue_result})
        if not revenue_result.get("ok"):
            failures += 1
        failures += _run_full_pipeline_for_store(store_id, model_version)

    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
