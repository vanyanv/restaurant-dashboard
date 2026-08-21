"""Rolling z-score anomaly detection.

For each (store, target) and the most recent observation, compute the
trailing 28-day mean + std (excluding the day under test). Score the
day's residual against that distribution; flag |z| > 3 with method
ZSCORE.

This is the simple, interpretable baseline the Phase 5 plan calls out
('rolling z-score for the simple per-series cases'). Multivariate
detection via Isolation Forest comes later.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Iterable

import numpy as np
import pandas as pd

from ml.db import connect, cuid_like
from ml.features.revenue import load_daily_revenue


WINDOW_DAYS = 28
Z_THRESHOLD = 3.0


@dataclass
class Anomaly:
    target: str  # AnomalyTarget enum value
    target_id: str | None
    occurred_on: dt.date
    residual: float
    #: None when the detector does not produce one — the interval detector
    #: has no pooled distribution to standardise against, and the column is
    #: nullable precisely so it need not invent a value.
    z_score: float | None
    #: AnomalyMethod enum value. Carried on the row rather than hardcoded in
    #: the INSERT so a second detector can share this writer.
    method: str = "ZSCORE"
    explanation: str | None = None


def _score_series(series: pd.Series, window: int = WINDOW_DAYS) -> Iterable[tuple[pd.Timestamp, float, float]]:
    """Yield (timestamp, residual, z) for the LAST observation only.

    We only ever flag the most recent day — older anomalies were already
    flagged on the day they happened (or weren't, and re-detection now
    would be noisy).
    """
    if len(series) < window + 1:
        return
    last_ts = series.index[-1]
    last_value = float(series.iloc[-1])
    history = series.iloc[-(window + 1) : -1]
    mean = float(history.mean())
    std = float(history.std(ddof=1))
    if std <= 0 or not np.isfinite(std):
        return
    residual = last_value - mean
    z = residual / std
    yield (last_ts, residual, z)


def detect_revenue_anomalies(store_id: str) -> list[Anomaly]:
    """Fallback detector for stores with no reconciled forecasts yet.

    Reads through `load_daily_revenue` rather than issuing its own SQL (F3).
    This was the only reader in the pipeline that skipped
    `trim_incomplete_trailing_days`, so it scored the newest business day while
    it was still being written — on a store that books 31.9% of net sales after
    21:00, that is a nightly false alarm that revenue collapsed. Going through
    the shared loader also picks up the evidence-based gap filling from F1, so
    an unsynced day arrives as NaN instead of a $0 outlier.

    Prefer `ml.anomaly.interval` wherever a forecast interval exists; a pooled
    z-score on a weekly-seasonal series is a blunt instrument (F4).
    """
    df = load_daily_revenue(store_id, lookback_days=60)
    if df.empty:
        return []
    series = df.set_index("date")["revenue"].astype(float).dropna()
    if series.empty:
        return []

    out: list[Anomaly] = []
    for ts, residual, z in _score_series(series):
        if abs(z) >= Z_THRESHOLD:
            out.append(
                Anomaly(
                    target="REVENUE",
                    target_id=None,
                    occurred_on=ts.date(),
                    residual=residual,
                    z_score=z,
                )
            )
    return out


def detect_menu_item_anomalies(store_id: str, item_names: list[str]) -> list[Anomaly]:
    if not item_names:
        return []
    sql = """
        SELECT date::date AS date,
               "itemName",
               SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS qty
        FROM "OtterMenuItem"
        WHERE "storeId" = %s
          AND "itemName" = ANY(%s)
          AND "isModifier" = false
          AND date >= (CURRENT_DATE - 60)
        GROUP BY date, "itemName"
        ORDER BY date
    """
    with connect() as conn:
        df = pd.read_sql_query(sql, conn, params=(store_id, item_names))
    if df.empty:
        return []
    df["date"] = pd.to_datetime(df["date"])

    out: list[Anomaly] = []
    for item_name, group in df.groupby("itemName"):
        # Reindex onto a contiguous calendar. A day with no sales for this
        # SKU produces no row at all, so without this the "trailing 28"
        # window spans however many calendar days it takes to find 28 rows,
        # and the variance is measured only over days the item did sell.
        series = group.set_index("date")["qty"].astype(float)
        series = series.reindex(
            pd.date_range(series.index.min(), series.index.max(), freq="D")
        ).fillna(0.0)
        for ts, residual, z in _score_series(series):
            if abs(z) >= Z_THRESHOLD:
                out.append(
                    Anomaly(
                        target="MENU_ITEM",
                        target_id=str(item_name),
                        occurred_on=ts.date(),
                        residual=residual,
                        z_score=z,
                    )
                )
    return out


def write_anomalies(store_id: str, anomalies: list[Anomaly]) -> int:
    if not anomalies:
        return 0
    sql = """
        INSERT INTO "AnomalyEvent"
            (id, "storeId", target, "targetId", "occurredOn",
             residual, "zScore", method, explanation, status)
        VALUES (%s, %s, %s::"AnomalyTarget", %s, %s, %s, %s,
                %s::"AnomalyMethod", %s, 'OPEN')
    """
    written = 0
    with connect() as conn:
        with conn.cursor() as cur:
            for a in anomalies:
                # Don't re-insert if we've already flagged this exact event
                # within the last day (happens if the workflow re-runs).
                cur.execute(
                    """
                    SELECT 1 FROM "AnomalyEvent"
                    WHERE "storeId" = %s
                      AND target = %s::"AnomalyTarget"
                      AND ("targetId" IS NOT DISTINCT FROM %s)
                      AND "occurredOn" = %s
                      AND "detectedAt" >= NOW() - INTERVAL '1 day'
                    LIMIT 1
                    """,
                    (store_id, a.target, a.target_id, a.occurred_on),
                )
                if cur.fetchone():
                    continue
                cur.execute(
                    sql,
                    (
                        cuid_like(),
                        store_id,
                        a.target,
                        a.target_id,
                        a.occurred_on,
                        a.residual,
                        a.z_score,
                        a.method,
                        a.explanation,
                    ),
                )
                written += 1
    return written
