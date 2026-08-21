"""F5 — the holiday feature omitted every holiday that moves.

The module docstring claimed the Phase 5 plan called out Mother's Day, Father's
Day, the Super Bowl and Easter "explicitly", and that the moving-date
approximations were included. `_FIXED_HOLIDAYS` held seven fixed calendar dates
and none of those four; Thanksgiving, Memorial Day and Labor Day were absent
too. The comment asserting otherwise is what stopped anyone looking.

Mother's Day is routinely a restaurant's highest-revenue day of the year, and it
had no representation in the feature matrix at all.

Two encodings, not one flag. `is_dining_holiday` covers the days people go out
(Mother's Day, Valentine's) and `is_closure_holiday` the days they stay home or
the store shuts (Thanksgiving, Christmas). Pooling several observations into
each is trainable on eighteen months of history; a per-holiday categorical,
with one or two observations apiece, is not.
"""
from __future__ import annotations

import datetime as dt

import pandas as pd
import pytest

from ml.features.holidays import (
    classify_holiday,
    easter_sunday,
    nth_weekday,
)
from ml.features.revenue import build_features, feature_columns


# --- the moving-date arithmetic ------------------------------------------------

@pytest.mark.parametrize("year,expected", [
    (2025, dt.date(2025, 4, 20)),
    (2026, dt.date(2026, 4, 5)),
    (2027, dt.date(2027, 3, 28)),
])
def test_easter_sunday(year, expected):
    assert easter_sunday(year) == expected


def test_nth_weekday_finds_second_sunday_of_may():
    # Mother's Day 2026.
    assert nth_weekday(2026, 5, weekday=6, n=2) == dt.date(2026, 5, 10)


def test_nth_weekday_supports_last_occurrence():
    # Memorial Day 2026 — last Monday of May.
    assert nth_weekday(2026, 5, weekday=0, n=-1) == dt.date(2026, 5, 25)


# --- classification ------------------------------------------------------------

@pytest.mark.parametrize("d,name", [
    (dt.date(2026, 5, 10), "mothers_day"),
    (dt.date(2026, 6, 21), "fathers_day"),
    (dt.date(2026, 2, 8),  "super_bowl"),
    (dt.date(2026, 4, 5),  "easter"),
    (dt.date(2026, 11, 26), "thanksgiving"),
    (dt.date(2026, 5, 25), "memorial_day"),
    (dt.date(2026, 9, 7),  "labor_day"),
    (dt.date(2026, 2, 14), "valentines"),
    (dt.date(2026, 12, 25), "christmas"),
    (dt.date(2026, 7, 4),  "july_4th"),
])
def test_known_holidays_are_named(d, name):
    assert classify_holiday(d) is not None, f"{d} ({name}) was not recognised"
    assert classify_holiday(d).name == name


def test_an_ordinary_tuesday_is_not_a_holiday():
    assert classify_holiday(dt.date(2026, 3, 17)) is None


def test_mothers_day_is_a_dining_holiday():
    h = classify_holiday(dt.date(2026, 5, 10))
    assert h.is_dining is True
    assert h.is_closure is False


def test_thanksgiving_is_a_closure_holiday():
    h = classify_holiday(dt.date(2026, 11, 26))
    assert h.is_closure is True
    assert h.is_dining is False


# --- integration with the feature matrix --------------------------------------

def _series_around(center: dt.date, days: int = 5) -> pd.DataFrame:
    dates = pd.date_range(
        pd.Timestamp(center) - pd.Timedelta(days=days),
        pd.Timestamp(center) + pd.Timedelta(days=days),
        freq="D",
    )
    return pd.DataFrame({"date": dates, "revenue": [5000.0] * len(dates)})


def test_build_features_flags_mothers_day():
    feats = build_features(_series_around(dt.date(2026, 5, 10)))
    row = feats[feats["date"] == pd.Timestamp("2026-05-10")].iloc[0]
    assert row["is_holiday"] == 1
    assert row["is_dining_holiday"] == 1
    assert row["is_closure_holiday"] == 0


def test_build_features_flags_the_shoulder_days():
    feats = build_features(_series_around(dt.date(2026, 11, 26)))
    eve = feats[feats["date"] == pd.Timestamp("2026-11-25")].iloc[0]
    after = feats[feats["date"] == pd.Timestamp("2026-11-27")].iloc[0]
    assert eve["is_day_before_holiday"] == 1
    assert after["is_day_after_holiday"] == 1
    # The holiday itself is neither shoulder.
    day = feats[feats["date"] == pd.Timestamp("2026-11-26")].iloc[0]
    assert day["is_day_before_holiday"] == 0
    assert day["is_day_after_holiday"] == 0


def test_the_new_flags_are_model_features():
    cols = feature_columns()
    for name in (
        "is_holiday",
        "is_dining_holiday",
        "is_closure_holiday",
        "is_day_before_holiday",
        "is_day_after_holiday",
    ):
        assert name in cols, f"{name} is computed but never reaches the model"
