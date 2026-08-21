"""F1 — a failed sync and a closed restaurant are not the same number.

`load_daily_revenue` reindexed onto a contiguous date range and called
`.fillna({"revenue": 0.0})`. Any date absent from `OtterDailySummary` — a
holiday closure, an Otter outage, a sync that never ran — became $0 of *observed
revenue*. That value was then used as a training target and propagated into
lag_1/7/14/28 and the 7/28/90-day rolling means, so one missed sync contaminated
feature rows for the following ninety days.

The evidence to tell the two apart was already being loaded two lines later:
`load_hourly_coverage` reports the highest hour bucket present per date. A date
whose hourly data reached closing time and still has no sales genuinely took no
money. A date with no hourly data at all was never observed, and the honest
value for it is NaN — not zero.

These tests pin the distinction at the pure-function boundary, and pin that a
NaN target can never reach `.fit()`.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd

from ml.features.completeness import CLOSED_DAY_VALUE, fill_calendar_gaps
from ml.features.revenue import build_features
from ml.models.revenue import _conformal_split


CLOSING_HOUR = 23


def _observed(pairs: list[tuple[str, float]]) -> pd.DataFrame:
    return pd.DataFrame({
        "date": pd.to_datetime([d for d, _ in pairs]),
        "revenue": [v for _, v in pairs],
    })


def _coverage(mapping: dict[str, int]) -> dict[dt.date, int]:
    return {dt.date.fromisoformat(k): v for k, v in mapping.items()}


def test_a_gap_with_complete_hourly_coverage_is_a_real_zero():
    # The 18th synced all the way to closing and booked nothing: genuinely shut.
    df = _observed([("2026-08-17", 5000.0), ("2026-08-19", 5200.0)])
    cov = _coverage({"2026-08-17": 23, "2026-08-18": 23, "2026-08-19": 23})

    out = fill_calendar_gaps(df, cov, CLOSING_HOUR)

    row = out[out["date"] == pd.Timestamp("2026-08-18")].iloc[0]
    assert row["revenue"] == CLOSED_DAY_VALUE == 0.0


def test_a_gap_with_no_hourly_coverage_is_unobserved_not_zero():
    # Nothing at all landed for the 18th — the sync did not run.
    df = _observed([("2026-08-17", 5000.0), ("2026-08-19", 5200.0)])
    cov = _coverage({"2026-08-17": 23, "2026-08-19": 23})

    out = fill_calendar_gaps(df, cov, CLOSING_HOUR)

    row = out[out["date"] == pd.Timestamp("2026-08-18")].iloc[0]
    assert np.isnan(row["revenue"]), "an unobserved day must not be fabricated as $0"


def test_a_partially_synced_gap_is_also_unobserved():
    # Hourly data stops at 14:00 — the evening, which is most of the revenue,
    # never arrived. Treating that as a complete zero is the original bug.
    df = _observed([("2026-08-17", 5000.0), ("2026-08-19", 5200.0)])
    cov = _coverage({"2026-08-17": 23, "2026-08-18": 14, "2026-08-19": 23})

    out = fill_calendar_gaps(df, cov, CLOSING_HOUR)

    row = out[out["date"] == pd.Timestamp("2026-08-18")].iloc[0]
    assert np.isnan(row["revenue"])


def test_observed_zero_stays_zero():
    # A date present in OtterDailySummary with 0 revenue is an observation.
    df = _observed([("2026-08-17", 5000.0), ("2026-08-18", 0.0), ("2026-08-19", 5200.0)])
    out = fill_calendar_gaps(df, {}, CLOSING_HOUR)

    row = out[out["date"] == pd.Timestamp("2026-08-18")].iloc[0]
    assert row["revenue"] == 0.0


def test_the_calendar_is_contiguous_so_lags_do_not_skip_days():
    df = _observed([("2026-08-17", 5000.0), ("2026-08-21", 5200.0)])
    out = fill_calendar_gaps(df, {}, CLOSING_HOUR)
    assert list(out["date"]) == list(pd.date_range("2026-08-17", "2026-08-21", freq="D"))


def test_empty_input_survives():
    out = fill_calendar_gaps(pd.DataFrame(columns=["date", "revenue"]), {}, CLOSING_HOUR)
    assert out.empty


def test_a_nan_target_never_reaches_the_fitting_set():
    """The split is what stands between an unobserved day and `.fit(X, y=NaN)`."""
    dates = pd.date_range("2025-01-01", periods=400, freq="D")
    revenue = np.full(400, 5000.0)
    revenue[200] = np.nan  # one unobserved day, mid-history
    feats = build_features(pd.DataFrame({"date": dates, "revenue": revenue}))

    train_df, calib_df, holdout_df = _conformal_split(feats, ["lag_1", "lag_7"])

    for name, part in (("train", train_df), ("calib", calib_df), ("holdout", holdout_df)):
        assert not part["revenue"].isna().any(), f"NaN target survived into {name}"
