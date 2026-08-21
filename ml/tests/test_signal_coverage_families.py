"""F6 — an OR over signal families cannot see a feed die.

`external_signal_coverage` returned `max(has_weather_signal, has_event_signal)`
averaged over rows. Weather alone therefore returned 1.0. With the PredictHQ
token dead, `sync_predicthq` exits at `skipped: missing_token`, no event row is
ever written, and the `>= 0.6` gate in `train()` still reported perfect
coverage.

The model then trained with roughly twenty event columns pinned at zero — dead
weight in every split candidate — while both the coverage number and the
`weather-events` flavor claimed the events were there.

Two properties pinned here: coverage is reported per family, and a family that
is not actually present contributes no columns to the fit.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from ml.features.external_signals import (
    EVENT_DAILY_COLUMNS,
    WEATHER_DAILY_COLUMNS,
    drop_dead_signal_columns,
    external_signal_coverage,
    external_signal_coverage_by_family,
)


def _signals(days: int = 30, *, weather: bool, events: bool) -> pd.DataFrame:
    dates = pd.date_range("2026-01-01", periods=days, freq="D")
    df = pd.DataFrame({"date": dates})
    df["has_weather_signal"] = 1.0 if weather else 0.0
    df["has_event_signal"] = 1.0 if events else 0.0
    return df


def test_weather_only_reports_zero_event_coverage():
    cov = external_signal_coverage_by_family(_signals(weather=True, events=False))
    assert cov["weather"] == pytest.approx(1.0)
    assert cov["events"] == pytest.approx(0.0)


def test_both_families_present():
    cov = external_signal_coverage_by_family(_signals(weather=True, events=True))
    assert cov["weather"] == pytest.approx(1.0)
    assert cov["events"] == pytest.approx(1.0)


def test_empty_frame_reports_zero_for_every_family():
    cov = external_signal_coverage_by_family(pd.DataFrame())
    assert cov == {"weather": 0.0, "events": 0.0}


def test_the_aggregate_still_answers_the_old_question():
    # Kept for the existing gate; it is the max, and that is now documented
    # rather than accidental.
    assert external_signal_coverage(_signals(weather=True, events=False)) == pytest.approx(1.0)


def test_a_dead_family_contributes_no_columns():
    cols = [*WEATHER_DAILY_COLUMNS, *EVENT_DAILY_COLUMNS]
    kept, dropped = drop_dead_signal_columns(
        cols, {"weather": 1.0, "events": 0.0}, floor=0.6
    )
    assert all(c in kept for c in WEATHER_DAILY_COLUMNS)
    assert not any(c in kept for c in EVENT_DAILY_COLUMNS)
    assert set(dropped) == set(EVENT_DAILY_COLUMNS)


def test_a_live_family_is_untouched():
    cols = [*WEATHER_DAILY_COLUMNS, *EVENT_DAILY_COLUMNS]
    kept, dropped = drop_dead_signal_columns(
        cols, {"weather": 1.0, "events": 1.0}, floor=0.6
    )
    assert kept == cols
    assert dropped == []


def test_non_signal_columns_are_never_dropped():
    cols = ["lag_1", "roll_7", *EVENT_DAILY_COLUMNS]
    kept, _ = drop_dead_signal_columns(cols, {"weather": 0.0, "events": 0.0}, floor=0.6)
    assert kept == ["lag_1", "roll_7"]


# --- integration with train() / forecast() -------------------------------------

def _enriched_history(days: int = 400, seed: int = 5) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-03-01", periods=days, freq="D")
    lift = np.where(dates.weekday.to_numpy() >= 5, 1.25, 1.0)
    revenue = (4500.0 * lift + rng.normal(0.0, 150.0, size=days)).clip(min=100.0)
    return pd.DataFrame({"date": dates, "revenue": revenue})


def _weather_only_signals(dates: pd.DatetimeIndex, seed: int = 3) -> pd.DataFrame:
    """Weather landed; PredictHQ never did."""
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({"date": dates})
    for col in WEATHER_DAILY_COLUMNS:
        df[col] = rng.normal(15.0, 4.0, size=len(dates))
    df["has_weather_signal"] = 1.0
    for col in EVENT_DAILY_COLUMNS:
        df[col] = 0.0
    df["has_event_signal"] = 0.0
    return df


@pytest.fixture
def weather_only(monkeypatch):
    from ml.models import revenue as revenue_model

    history = _enriched_history()
    signals = _weather_only_signals(pd.DatetimeIndex(history["date"]))
    monkeypatch.setattr(
        revenue_model, "load_daily_revenue",
        lambda store_id, lookback_days=540: history.copy(),
    )
    monkeypatch.setattr(
        revenue_model, "load_revenue_external_signals",
        lambda store_id, start=None, end=None: signals.copy(),
    )
    return revenue_model


def test_dead_event_columns_never_reach_the_fit(weather_only):
    result = weather_only.train("store-test", enriched=True)
    assert result is not None
    assert not set(result.feature_names) & set(EVENT_DAILY_COLUMNS), (
        "event columns were fit despite the feed being dead"
    )
    assert set(WEATHER_DAILY_COLUMNS) <= set(result.feature_names)


def test_per_family_coverage_travels_on_the_result(weather_only):
    result = weather_only.train("store-test", enriched=True)
    assert result is not None
    assert result.signal_families["weather"] == pytest.approx(1.0)
    assert result.signal_families["events"] == pytest.approx(0.0)


def test_forecasting_survives_a_reduced_feature_set(weather_only):
    result = weather_only.train("store-test", enriched=True)
    assert result is not None
    rows = weather_only.forecast("store-test", result, horizon_days=5)
    assert len(rows) == 5
    for row in rows:
        assert row.p10 <= row.predicted_revenue <= row.p90
