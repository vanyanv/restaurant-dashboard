"""Regression (August 2026): the model anchored on a day that was still open.

`ml-nightly` runs at 06:00 UTC. The last `otter-sync` before it is the 04:00 UTC
run, which is 21:00 Pacific — and Hollywood takes **31.9%** of its daily net
sales after 21:00, peaking at 22:00-23:00. So the most recent day in
`load_daily_revenue` was about 68% of its real value every single night, and
`lag_1` — the feature the model leans on hardest — was a third too low.

Reproduced against production data over the trailing 45 days, 1-step:

    complete history                      bias  +3.4%   MAPE 14.6%
    previous day shaved to 68.1%          bias  -7.9%   MAPE 19.7%
    production, horizon 1d, same period   bias  -6.7%   MAPE 10.6%

Same disease as the reconciliation bug fixed earlier the same day: a still-open
business day read as though it were finished.

The fix trims *trailing* incomplete days only. A day is complete when its hourly
data reaches the store's closing hour. Trimming only from the end means a day
that genuinely closed early mid-series is left alone — the guard exists to stop
the series ending on a half-day, not to police history.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from ml.features.revenue import trim_incomplete_trailing_days  # re-exported
from ml.features.completeness import (
    incomplete_trailing_dates,
    trim_incomplete_trailing_days as trim_shared,
)


def _daily(dates: list[str]) -> pd.DataFrame:
    return pd.DataFrame({
        "date": pd.to_datetime(dates),
        "revenue": [5000.0 + i for i in range(len(dates))],
    })


def _coverage(mapping: dict[str, int]) -> dict[dt.date, int]:
    """date -> highest hour bucket present in OtterHourlySummary."""
    return {dt.date.fromisoformat(k): v for k, v in mapping.items()}


CLOSING_HOUR = 23


def test_drops_a_trailing_day_that_is_still_open():
    df = _daily(["2026-08-17", "2026-08-18", "2026-08-19"])
    cov = _coverage({"2026-08-17": 23, "2026-08-18": 23, "2026-08-19": 20})
    out = trim_incomplete_trailing_days(df, cov, CLOSING_HOUR)
    assert list(out["date"].dt.strftime("%Y-%m-%d")) == ["2026-08-17", "2026-08-18"]


def test_keeps_everything_when_the_last_day_is_finished():
    df = _daily(["2026-08-17", "2026-08-18", "2026-08-19"])
    cov = _coverage({"2026-08-17": 23, "2026-08-18": 23, "2026-08-19": 23})
    out = trim_incomplete_trailing_days(df, cov, CLOSING_HOUR)
    assert len(out) == 3


def test_trims_several_trailing_days_if_the_sync_has_been_down():
    df = _daily(["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"])
    cov = _coverage({"2026-08-16": 23, "2026-08-17": 23, "2026-08-18": 19, "2026-08-19": 14})
    out = trim_incomplete_trailing_days(df, cov, CLOSING_HOUR)
    assert list(out["date"].dt.strftime("%Y-%m-%d")) == ["2026-08-16", "2026-08-17"]


def test_leaves_an_early_close_in_the_middle_of_the_series_alone():
    """An interior short day is a real short day — a holiday, a closure. Only
    the tail is suspect, because only the tail can be mid-sync."""
    df = _daily(["2026-08-16", "2026-08-17", "2026-08-18", "2026-08-19"])
    cov = _coverage({"2026-08-16": 23, "2026-08-17": 17, "2026-08-18": 23, "2026-08-19": 23})
    out = trim_incomplete_trailing_days(df, cov, CLOSING_HOUR)
    assert len(out) == 4


def test_a_day_with_no_hourly_coverage_at_all_is_incomplete():
    df = _daily(["2026-08-17", "2026-08-18", "2026-08-19"])
    cov = _coverage({"2026-08-17": 23, "2026-08-18": 23})
    out = trim_incomplete_trailing_days(df, cov, CLOSING_HOUR)
    assert list(out["date"].dt.strftime("%Y-%m-%d")) == ["2026-08-17", "2026-08-18"]


def test_never_empties_the_series():
    """If coverage lookup is broken, a model trained on nothing is worse than a
    model trained on slightly stale data. Fail open."""
    df = _daily(["2026-08-17", "2026-08-18", "2026-08-19"])
    out = trim_incomplete_trailing_days(df, {}, CLOSING_HOUR)
    assert len(out) == 3


def test_empty_input_is_returned_untouched():
    df = pd.DataFrame({"date": pd.to_datetime([]), "revenue": []})
    assert trim_incomplete_trailing_days(df, {}, CLOSING_HOUR).empty


# --- the hourly grain: many rows per date -----------------------------------
#
# This is where the bug bit hardest. `complete_hourly_grid` reindexes onto a
# full 24-hour grid and fills gaps with 0.0, so a day that had only synced to
# hour 13 got hours 14-23 written as ZERO orders — the store's busiest stretch,
# 31.9% of its daily take — straight into orders_lag_24 and the hour-of-day
# rolling means.

def _hourly(rows: list[tuple[str, int]]) -> pd.DataFrame:
    return pd.DataFrame({
        "date": pd.to_datetime([d for d, _ in rows]),
        "hour": [h for _, h in rows],
        "orders": [10.0] * len(rows),
    })


def test_trims_whole_dates_at_the_hourly_grain():
    df = _hourly(
        [("2026-08-18", h) for h in range(24)] + [("2026-08-19", h) for h in range(14)]
    )
    cov = _coverage({"2026-08-18": 23, "2026-08-19": 13})
    out = trim_shared(df, cov, CLOSING_HOUR)
    assert set(out["date"].dt.strftime("%Y-%m-%d")) == {"2026-08-18"}
    assert len(out) == 24


def test_keeps_a_finished_day_whole_at_the_hourly_grain():
    df = _hourly([("2026-08-18", h) for h in range(24)] + [("2026-08-19", h) for h in range(24)])
    cov = _coverage({"2026-08-18": 23, "2026-08-19": 23})
    assert len(trim_shared(df, cov, CLOSING_HOUR)) == 48


def test_incomplete_trailing_dates_stops_at_the_first_finished_day():
    cov = _coverage({"2026-08-16": 23, "2026-08-17": 12, "2026-08-18": 23, "2026-08-19": 9})
    dates = [dt.date(2026, 8, d) for d in (16, 17, 18, 19)]
    # 19 is incomplete; 18 is finished, so the walk stops and 17 is left alone.
    assert incomplete_trailing_dates(dates, cov, CLOSING_HOUR) == {dt.date(2026, 8, 19)}


def test_frame_without_a_date_column_is_returned_untouched():
    df = pd.DataFrame({"hour": [1, 2], "orders": [3.0, 4.0]})
    assert len(trim_shared(df, _coverage({"2026-08-19": 5}), CLOSING_HOUR)) == 2
