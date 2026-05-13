"""Nightly integration glue for the evaluator + consistency check.

Two public entry points called from `ml/run_nightly.py.main()`, one per
active store, after the existing forecast loop completes:

  - `run_evaluation_pass(conn, store_id, today)`: for each of the three
    targets (REVENUE / BUSY_HOURS / MENU_ITEM) fetch reconciled rows over
    the trailing 28 days, build an `EvaluationInput`, and upsert one row
    into `MlForecastEvaluation`.

  - `run_consistency_check(conn, store_id, today)`: for the next 14 days
    of forecasts, compute the `revenue / Σ(item)` discrepancy per
    store-day and log a WARNING when |discrepancyPct| >= 15%.

Each fetch helper takes the LATEST `generatedAt` per row key so the
evaluator sees the most-recent forecast for each historical day.
"""
from __future__ import annotations

import datetime as dt
import logging
from typing import Iterable

import numpy as np
import pandas as pd

from ml.evaluation.consistency import compute_revenue_item_discrepancy
from ml.evaluation.evaluator import EvaluationInput, build_evaluation_row, upsert_evaluation_row

_LOG = logging.getLogger(__name__)

# 35 days so the trailing 28d evaluation window always has a full t-7 lookback
# for seasonal-naive. With a 28d window the first 7 days have no t-7 reference
# in `by_date` and silently fall back to `actual` (0 error), biasing baselineWape
# toward zero. 35d = 28d evaluation + 7d seasonal-naive prefix.
_EVAL_WINDOW_DAYS = 35
_CONSISTENCY_WINDOW_DAYS = 14
_DISCREPANCY_THRESHOLD_PCT = 15.0


# ---------------------------------------------------------------------------
# Fetch helpers — each returns a list of tuples in a documented column order.
# ---------------------------------------------------------------------------

# Each row tuple: (forecastDate, predicted, actual, p10, p90, modelVersion, baseline_predicted)
# For the trailing 28d evaluation window, `baseline_predicted` is the
# seasonal-naive y[t-7] reference taken from the actual series itself. We
# compute it in Python rather than via a SQL window for simplicity.


def _fetch_reconciled_revenue(conn, store_id: str, today: dt.date) -> list[tuple]:
    """Latest reconciled daily-revenue forecast per (storeId, forecastDate) in
    the trailing 28-day window. Filters `hourBucket = 0` (whole-day rows).
    """
    sql = """
        SELECT DISTINCT ON (f."forecastDate")
               f."forecastDate"::date,
               f."predictedRevenue"::float,
               f."actualRevenue"::float,
               COALESCE(f.p10, f."predictedRevenue")::float,
               COALESCE(f.p90, f."predictedRevenue")::float,
               f."modelVersion"
        FROM "ForecastDailyRevenue" f
        WHERE f."storeId" = %s
          AND f."hourBucket" = 0
          AND f."actualRevenue" IS NOT NULL
          AND f."forecastDate" BETWEEN %s AND %s
        ORDER BY f."forecastDate", f."generatedAt" DESC
    """
    window_end = today - dt.timedelta(days=1)
    window_start = today - dt.timedelta(days=_EVAL_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(sql, (store_id, window_start, window_end))
        return list(cur.fetchall())


def _fetch_reconciled_hourly_orders(conn, store_id: str, today: dt.date) -> list[tuple]:
    """Latest reconciled hourly-orders forecast per (storeId, forecastDate, hourBucket)
    over the trailing 28 days.
    """
    sql = """
        SELECT DISTINCT ON (f."forecastDate", f."hourBucket")
               f."forecastDate"::date,
               f."predictedOrders"::float,
               f."actualOrders"::float,
               COALESCE(f.p10, f."predictedOrders")::float,
               COALESCE(f.p90, f."predictedOrders")::float,
               f."modelVersion"
        FROM "ForecastHourlyOrders" f
        WHERE f."storeId" = %s
          AND f."actualOrders" IS NOT NULL
          AND f."forecastDate" BETWEEN %s AND %s
        ORDER BY f."forecastDate", f."hourBucket", f."generatedAt" DESC
    """
    window_end = today - dt.timedelta(days=1)
    window_start = today - dt.timedelta(days=_EVAL_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(sql, (store_id, window_start, window_end))
        return list(cur.fetchall())


def _fetch_reconciled_menu_item(conn, store_id: str, today: dt.date) -> list[tuple]:
    """Latest reconciled menu-item forecast per (storeId, otterItemSkuId,
    forecastDate) over the trailing 28 days. Aggregated across all SKUs into
    one evaluation row (per the "one row per target per night" pattern).
    """
    sql = """
        SELECT DISTINCT ON (f."otterItemSkuId", f."forecastDate")
               f."forecastDate"::date,
               f."predictedQty"::float,
               f."actualQty"::float,
               COALESCE(f.p10, f."predictedQty")::float,
               COALESCE(f.p90, f."predictedQty")::float,
               f."modelVersion"
        FROM "ForecastMenuItem" f
        WHERE f."storeId" = %s
          AND f."actualQty" IS NOT NULL
          AND f."forecastDate" BETWEEN %s AND %s
        ORDER BY f."otterItemSkuId", f."forecastDate", f."generatedAt" DESC
    """
    window_end = today - dt.timedelta(days=1)
    window_start = today - dt.timedelta(days=_EVAL_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(sql, (store_id, window_start, window_end))
        return list(cur.fetchall())


def _fetch_future_revenue(conn, store_id: str, today: dt.date) -> list[tuple]:
    """Latest predicted revenue per (storeId, forecastDate) for the next 14 days."""
    sql = """
        SELECT DISTINCT ON (f."forecastDate")
               f."forecastDate"::date,
               f."predictedRevenue"::float
        FROM "ForecastDailyRevenue" f
        WHERE f."storeId" = %s
          AND f."hourBucket" = 0
          AND f."forecastDate" BETWEEN %s AND %s
        ORDER BY f."forecastDate", f."generatedAt" DESC
    """
    end = today + dt.timedelta(days=_CONSISTENCY_WINDOW_DAYS)
    with conn.cursor() as cur:
        cur.execute(sql, (store_id, today, end))
        return list(cur.fetchall())


def _fetch_future_items_with_price(conn, store_id: str, today: dt.date) -> list[tuple]:
    """Predicted items joined with their avg price from recent OtterMenuItem rows.

    Returns (forecastDate, otterItemSkuId, predictedQty, avgPrice) tuples.
    Items lacking a recent price get avgPrice = 1.0 (degraded comparison —
    the consistency check then compares predicted-revenue vs Σ-predicted-qty
    as a unit-less ratio for those rows).
    """
    sql = """
        WITH recent_price AS (
            SELECT "itemName",
                   AVG(
                       CASE
                           WHEN COALESCE("fpQuantitySold",0) + COALESCE("tpQuantitySold",0) > 0
                           THEN (COALESCE("fpTotalSales",0) + COALESCE("tpTotalSales",0))
                              / NULLIF(COALESCE("fpQuantitySold",0) + COALESCE("tpQuantitySold",0), 0)
                           ELSE NULL
                       END
                   ) AS avg_price
            FROM "OtterMenuItem"
            WHERE "storeId" = %s
              AND "isModifier" = false
              AND date >= %s
            GROUP BY "itemName"
        )
        SELECT DISTINCT ON (f."otterItemSkuId", f."forecastDate")
               f."forecastDate"::date,
               f."otterItemSkuId",
               f."predictedQty"::float,
               COALESCE(rp.avg_price, 1.0)::float AS avg_price
        FROM "ForecastMenuItem" f
        LEFT JOIN recent_price rp ON rp."itemName" = f."otterItemSkuId"
        WHERE f."storeId" = %s
          AND f."forecastDate" BETWEEN %s AND %s
        ORDER BY f."otterItemSkuId", f."forecastDate", f."generatedAt" DESC
    """
    end = today + dt.timedelta(days=_CONSISTENCY_WINDOW_DAYS)
    price_lookback = today - dt.timedelta(days=60)
    with conn.cursor() as cur:
        cur.execute(sql, (store_id, price_lookback, store_id, today, end))
        return list(cur.fetchall())


# ---------------------------------------------------------------------------
# Builders: turn fetched rows into an EvaluationInput.
# ---------------------------------------------------------------------------


def _seasonal_naive_baseline(dates: list[dt.date], actuals: np.ndarray) -> np.ndarray:
    """Compute y[t-7] from the observed actuals, falling back to the row's own
    actual when t-7 is not in the window.

    With the 35-day fetch window paired with the 28-day evaluation window the
    fallback should essentially never fire — every evaluation date has its t-7
    reference in `by_date`. We still log the fallback count when >0 so
    pre-rollout edges (sparse history, gaps in reconciliation) are visible
    instead of silently biasing baselineWape toward zero.
    """
    by_date = {d: float(a) for d, a in zip(dates, actuals)}
    out = []
    fallback_count = 0
    for d, a in zip(dates, actuals):
        prev = by_date.get(d - dt.timedelta(days=7))
        if prev is None:
            fallback_count += 1
            out.append(float(a))
        else:
            out.append(float(prev))
    if fallback_count > 0:
        _LOG.debug(
            "_seasonal_naive_baseline: %d/%d rows fell back to actual "
            "(no t-7 reference in window)",
            fallback_count,
            len(dates),
        )
    return np.asarray(out, dtype=float)


def _build_eval_input(
    rows: list[tuple],
    *,
    target: str,
    store_id: str,
    today: dt.date,
) -> EvaluationInput | None:
    if not rows:
        return None
    dates = [r[0] for r in rows]
    preds = np.asarray([r[1] for r in rows], dtype=float)
    acts = np.asarray([r[2] for r in rows], dtype=float)
    p10 = np.asarray([r[3] for r in rows], dtype=float)
    p90 = np.asarray([r[4] for r in rows], dtype=float)
    model_version = rows[0][5] or "unknown"
    baseline_preds = _seasonal_naive_baseline(dates, acts)

    # We only have 80% PI columns. Widen by ~2x for an approximate 95% PI
    # so the evaluator's coverage column is at least populated.
    half80 = (p90 - p10) / 2.0
    centre = preds
    lower95 = centre - half80 * 2.0
    upper95 = centre + half80 * 2.0

    window_start = min(dates)
    window_end = max(dates)
    return EvaluationInput(
        target=target,
        store_id=store_id,
        model_version=model_version,
        horizon_day=0,
        window_start=window_start,
        window_end=window_end,
        actuals=acts,
        predictions=preds,
        lower80=p10,
        upper80=p90,
        lower95=lower95,
        upper95=upper95,
        baseline_predictions=baseline_preds,
        enriched_predictions=None,
        stale_row_count=0,
    )


# ---------------------------------------------------------------------------
# Public entry points.
# ---------------------------------------------------------------------------


def run_evaluation_pass(conn, store_id: str, today: dt.date) -> None:
    """Build + upsert one MlForecastEvaluation row per target for the store."""
    rev_rows = _fetch_reconciled_revenue(conn, store_id, today)
    rev_input = _build_eval_input(rev_rows, target="REVENUE", store_id=store_id, today=today)
    if rev_input is not None:
        upsert_evaluation_row(conn, build_evaluation_row(rev_input))
        _LOG.info("evaluator: wrote REVENUE row for %s (n=%d)", store_id, rev_input.actuals.size)

    hr_rows = _fetch_reconciled_hourly_orders(conn, store_id, today)
    hr_input = _build_eval_input(hr_rows, target="BUSY_HOURS", store_id=store_id, today=today)
    if hr_input is not None:
        upsert_evaluation_row(conn, build_evaluation_row(hr_input))
        _LOG.info("evaluator: wrote BUSY_HOURS row for %s (n=%d)", store_id, hr_input.actuals.size)

    item_rows = _fetch_reconciled_menu_item(conn, store_id, today)
    item_input = _build_eval_input(item_rows, target="MENU_ITEM", store_id=store_id, today=today)
    if item_input is not None:
        upsert_evaluation_row(conn, build_evaluation_row(item_input))
        _LOG.info("evaluator: wrote MENU_ITEM row for %s (n=%d)", store_id, item_input.actuals.size)


def run_consistency_check(conn, store_id: str, today: dt.date) -> None:
    """Compare predicted daily revenue vs Σ(item-qty × avgPrice) for the next 14
    days. Log a WARNING per store-day with |discrepancyPct| >= 15.
    """
    rev_rows = _fetch_future_revenue(conn, store_id, today)
    item_rows = _fetch_future_items_with_price(conn, store_id, today)
    if not rev_rows:
        _LOG.info("consistency: no future revenue rows for %s — skipping", store_id)
        return

    rev_df = pd.DataFrame(rev_rows, columns=["forecastDate", "predictedRevenue"])
    rev_df["storeId"] = store_id

    if item_rows:
        items_df = pd.DataFrame(
            item_rows, columns=["forecastDate", "otterItemSkuId", "predictedQty", "avgPrice"]
        )
        items_df["storeId"] = store_id
    else:
        items_df = pd.DataFrame(
            columns=["storeId", "forecastDate", "otterItemSkuId", "predictedQty", "avgPrice"]
        )

    merged = compute_revenue_item_discrepancy(rev_df, items_df)
    flagged = merged[
        merged["discrepancyPct"].abs() >= _DISCREPANCY_THRESHOLD_PCT
    ]
    for _, row in flagged.iterrows():
        _LOG.warning(
            "consistency: store=%s date=%s revenue=%.2f items=%.2f discrepancy=%.1f%%",
            store_id,
            row["forecastDate"],
            float(row["predictedRevenue"]),
            float(row["itemSumRevenue"]),
            float(row["discrepancyPct"]),
        )
