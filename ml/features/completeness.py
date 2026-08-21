"""Guard against training on a business day that is still open.

`ml-nightly` used to run at 06:00 UTC; the last `otter-sync` before it is the
04:00 UTC run, which is 21:00 Pacific. Hollywood takes **31.9%** of its daily
net sales after 21:00, peaking at 22:00-23:00 — so the newest day in every
loader arrived roughly 68% written.

For daily revenue that meant `lag_1` was a third too low. Measured over the
trailing 45 days, 1-step: bias +3.4% on complete history against -7.9% with the
previous day shaved to 68.1%; production ran -6.7%.

For hourly orders it is worse, because `complete_hourly_grid` reindexes onto a
full 24-hour grid and fills gaps with 0.0 — the unsynced evening hours, the
busiest of the day, were written as *zero orders* and fed straight into
`orders_lag_24` and the hour-of-day rolling means.

Every loader that reads an Otter table by date should trim through here.
"""
from __future__ import annotations

from datetime import date
from typing import Iterable

import pandas as pd

from ml.db import connect

#: Hour bucket a completed business day is expected to reach. Hollywood's hourly
#: curve peaks at 22:00-23:00, so a date whose hourly data stops short of this is
#: still being written.
DEFAULT_CLOSING_HOUR = 23


def load_hourly_coverage(store_id: str, lookback_days: int = 540) -> dict[date, int]:
    """Highest hour bucket present per date in OtterHourlySummary."""
    sql = """
        SELECT date::date AS date, MAX(hour) AS max_hour
        FROM "OtterHourlySummary"
        WHERE "storeId" = %s
          AND date >= (CURRENT_DATE - %s::int)
        GROUP BY date
    """
    with connect() as conn:
        df = pd.read_sql_query(sql, conn, params=(store_id, lookback_days))
    if df.empty:
        return {}
    return {r.date: int(r.max_hour) for r in df.itertuples()}


#: What a date takes when the evidence says it was open-and-empty rather than
#: unobserved. Named so the intent survives the next reader.
CLOSED_DAY_VALUE = 0.0


def fill_calendar_gaps(
    df: pd.DataFrame,
    coverage: dict[date, int],
    closing_hour: int = DEFAULT_CLOSING_HOUR,
    value_col: str = "revenue",
) -> pd.DataFrame:
    """Reindex onto a contiguous daily calendar without inventing observations.

    Lag and rolling features are positional, so the calendar has to be gap-free
    — but the value on a filled day depends on what we can actually show:

    - hourly data reached `closing_hour` and no sales row exists → the day was
      observed and took nothing. `CLOSED_DAY_VALUE`.
    - hourly data is short or absent → nobody watched. `NaN`, which the
      training split then drops.

    The distinction is the whole point. `.fillna(0.0)` collapsed both onto zero,
    and the zero was a training target as well as ninety days of lag inputs.
    """
    if df.empty or "date" not in df:
        return df

    out = df.copy()
    out["date"] = pd.to_datetime(out["date"])
    full_range = pd.date_range(out["date"].min(), out["date"].max(), freq="D")
    out = (
        out.set_index("date")
        .reindex(full_range)
        .rename_axis("date")
        .reset_index()
    )

    missing = out[value_col].isna()
    if missing.any():
        synced = out.loc[missing, "date"].dt.date.map(
            lambda d: coverage.get(d, -1) >= closing_hour
        )
        out.loc[missing & synced.reindex(out.index, fill_value=False), value_col] = (
            CLOSED_DAY_VALUE
        )
    out[value_col] = out[value_col].astype(float)
    return out


def incomplete_trailing_dates(
    dates: Iterable[date],
    coverage: dict[date, int],
    closing_hour: int = DEFAULT_CLOSING_HOUR,
) -> set[date]:
    """Trailing dates whose hourly data hasn't reached closing time.

    Only the tail. An interior short day is a real short day — a holiday, a
    closure — and rewriting history is not this function's job; only the tail
    can be mid-sync.
    """
    out: set[date] = set()
    for d in sorted(set(dates), reverse=True):
        if coverage.get(d, -1) >= closing_hour:
            break
        out.add(d)
    return out


def trim_incomplete_trailing_days(
    df: pd.DataFrame,
    coverage: dict[date, int],
    closing_hour: int = DEFAULT_CLOSING_HOUR,
) -> pd.DataFrame:
    """Drop rows on trailing dates that are still being written.

    Works at either grain: one row per date (daily revenue, menu-item quantity)
    or many (hourly orders). Fails open — if coverage is unavailable, or every
    date looks incomplete, the frame is returned untouched, because a model
    trained on slightly stale data beats one trained on nothing.
    """
    if df.empty or not coverage or "date" not in df:
        return df

    day = pd.to_datetime(df["date"]).dt.date
    bad = incomplete_trailing_dates(day, coverage, closing_hour)
    if not bad:
        return df

    kept = df[~day.isin(bad)]
    if kept.empty:
        return df
    return kept.reset_index(drop=True)
