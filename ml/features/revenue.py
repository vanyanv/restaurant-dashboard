"""Daily-revenue feature engineering.

Pulls the OtterDailySummary history per store and produces a feature
matrix the revenue model can train on. Daily revenue is the sum of FP
net sales + 3P net sales across platforms.

Feature design follows the Phase 5 plan:
  - Time: weekday, month, day-of-month
  - Holidays: the day itself, split into dining vs closure, plus both
    shoulder days. See `ml.features.holidays`.
  - Lags: 1d, 7d, 14d, 28d
  - Rolling: 7d / 28d / 90d mean and std
  - Trend: 90-day store growth rate
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from ml.db import connect
from ml.features.holidays import classify_holiday, is_holiday
from ml.features.completeness import (
    DEFAULT_CLOSING_HOUR,
    fill_calendar_gaps,
    load_hourly_coverage,
    trim_incomplete_trailing_days,
)
from ml.features.external_signals import (
    daily_signal_feature_columns,
    fill_event_daily_defaults,
    fill_weather_daily_defaults,
    load_daily_external_signals,
)


_LOG = logging.getLogger(__name__)


def _holiday_frame(dates: pd.Series) -> pd.DataFrame:
    """Holiday flags for a date series — the day itself and its shoulders.

    See `ml.features.holidays`. The shoulder days carry as much signal as the
    holiday: the Wednesday before Thanksgiving is one of the busiest nights of
    the year, and the day after Christmas is dead.
    """
    days = pd.to_datetime(dates).dt.date
    classified = days.map(classify_holiday)

    return pd.DataFrame({
        "is_holiday": classified.notna().astype(int).to_numpy(),
        "is_dining_holiday": classified.map(
            lambda h: 1 if h is not None and h.is_dining else 0
        ).to_numpy(),
        "is_closure_holiday": classified.map(
            lambda h: 1 if h is not None and h.is_closure else 0
        ).to_numpy(),
        "is_day_before_holiday": days.map(
            lambda d: 1 if is_holiday(d + timedelta(days=1)) else 0
        ).to_numpy(),
        "is_day_after_holiday": days.map(
            lambda d: 1 if is_holiday(d - timedelta(days=1)) else 0
        ).to_numpy(),
    }, index=dates.index)


def load_daily_revenue(store_id: str, lookback_days: int = 540) -> pd.DataFrame:
    """Load store daily revenue from OtterDailySummary, summed across rows.

    Returns columns: ['date' (datetime64[D]), 'revenue' (float)] on a gap-free
    daily calendar. A date with no sales row is $0 when its hourly data proves
    the day was watched to closing, and NaN when it does not — see
    `fill_calendar_gaps`. NaN days are dropped by the training splits.
    """
    sql = """
        SELECT date::date AS date,
               SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0)) AS revenue
        FROM "OtterDailySummary"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
        GROUP BY date
        ORDER BY date
    """
    with connect() as conn:
        df = pd.read_sql_query(sql, conn, params=(store_id, lookback_days))

    if df.empty:
        return df

    # Reindex to a contiguous daily range so lag features don't skip days.
    # Gaps are filled from evidence, not with zero: a date whose hourly data
    # reached closing time and still has no sales row was open and empty; a date
    # with short or absent hourly data was never observed and stays NaN. See
    # `fill_calendar_gaps` — the old `.fillna(0.0)` made both a training target.
    df["date"] = pd.to_datetime(df["date"])
    coverage = load_hourly_coverage(store_id, lookback_days)
    df = fill_calendar_gaps(df, coverage)
    unobserved = int(df["revenue"].isna().sum())
    if unobserved:
        _LOG.warning(
            "load_daily_revenue: %s day(s) unobserved for store %s — excluded from training",
            unobserved,
            store_id,
        )
    # The newest day is usually still being written when the nightly runs; an
    # anchor a third too low drags every horizon down with it.
    return trim_incomplete_trailing_days(df, coverage)


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Augment a daily-revenue series with the standard feature set."""
    if df.empty:
        return df.assign()

    out = df.copy()
    out["weekday"] = out["date"].dt.weekday
    out["is_weekend"] = (out["weekday"] >= 5).astype(int)
    out["month"] = out["date"].dt.month
    out["day_of_month"] = out["date"].dt.day
    for name, values in _holiday_frame(out["date"]).items():
        out[name] = values

    for lag in (1, 7, 14, 28):
        out[f"lag_{lag}"] = out["revenue"].shift(lag)

    out["roll_7"] = out["revenue"].rolling(7).mean().shift(1)
    out["roll_28"] = out["revenue"].rolling(28).mean().shift(1)
    out["roll_7_std"] = out["revenue"].rolling(7).std().shift(1)
    out["roll_90"] = out["revenue"].rolling(90).mean().shift(1)
    out["growth_rate_90"] = (out["roll_28"] - out["roll_90"]) / out["roll_90"].replace(0, np.nan)
    return out


def build_enriched_features(
    df: pd.DataFrame,
    external_daily: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Build baseline revenue features plus daily weather/event signals."""
    out = build_features(df)
    if out.empty:
        return out
    if external_daily is None or external_daily.empty:
        external_daily = pd.DataFrame({"date": out["date"].drop_duplicates()})
    external_daily = fill_event_daily_defaults(fill_weather_daily_defaults(external_daily))
    out = out.merge(external_daily, on="date", how="left")
    out = fill_event_daily_defaults(fill_weather_daily_defaults(out))
    return out


def feature_columns() -> list[str]:
    return [
        "weekday",
        "is_weekend",
        "month",
        "day_of_month",
        "is_holiday",
        "is_dining_holiday",
        "is_closure_holiday",
        "is_day_before_holiday",
        "is_day_after_holiday",
        "lag_1",
        "lag_7",
        "lag_14",
        "lag_28",
        "roll_7",
        "roll_28",
        "roll_7_std",
        "roll_90",
        "growth_rate_90",
    ]


def enriched_feature_columns() -> list[str]:
    return [*feature_columns(), *daily_signal_feature_columns()]


def load_revenue_external_signals(
    store_id: str,
    start_date: date | None = None,
    end_date: date | None = None,
) -> pd.DataFrame:
    return load_daily_external_signals(store_id, start_date, end_date)


def split_train_holdout(
    df: pd.DataFrame, holdout_days: int = 30
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Chronological split — never random for time series.

    `revenue` joins the dropna subset for the same reason as `_conformal_split`:
    an unobserved day is NaN, and NaN is not a target (F1).
    """
    df = df.dropna(subset=[*feature_columns(), "revenue"]).reset_index(drop=True)
    if len(df) <= holdout_days:
        return df.iloc[: len(df) // 2], df.iloc[len(df) // 2 :]
    return df.iloc[:-holdout_days], df.iloc[-holdout_days:]


def list_active_store_ids() -> list[str]:
    sql = 'SELECT id FROM "Store" WHERE "isActive" = true ORDER BY "createdAt"'
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            return [row[0] for row in cur.fetchall()]


def list_stores_by_stage(*, stages: tuple[str, ...]) -> list[str]:
    """Active store IDs filtered by `Store.lifecycleStage`.

    Pass e.g. `("ready",)` to enumerate stores that should train native
    models, or `("warming_up",)` for the transfer-writer pass. See spec
    §1 for the lifecycle definition.
    """
    sql = '''
        SELECT id FROM "Store"
        WHERE "isActive" = true
          AND "lifecycleStage"::TEXT = ANY(%s)
        ORDER BY name
    '''
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (list(stages),))
            return [row[0] for row in cur.fetchall()]


def latest_history_date(store_id: str) -> Optional[datetime]:
    sql = 'SELECT MAX(date) FROM "OtterDailySummary" WHERE "storeId" = %s'
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, (store_id,))
            row = cur.fetchone()
            return row[0] if row and row[0] else None
