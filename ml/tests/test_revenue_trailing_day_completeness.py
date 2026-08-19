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

from ml.features.revenue import trim_incomplete_trailing_days


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
