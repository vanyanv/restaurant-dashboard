"""F7 — a rolling-origin backtest that lives in the repository.

The two most consequential numbers in this codebase were in a comment in
`ml/models/revenue.py`: bias -5.4% -> -1.9%, MAPE 10.4% -> 9.4%, over ten
chronological cutoffs at 14-day horizons. That work was real. It was also done
by a script nobody committed, so it cannot be re-run against a new candidate
model, cannot be extended, and cannot fail in CI.

Every open modelling question — global vs per-store, direct vs recursive,
quantile vs symmetric intervals — is undecidable without this. It walks the real
`train()` -> `forecast()` path with history truncated at each cutoff, and scores
*per horizon day*, because a 1-day error and a 14-day error are different
products.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.backtest import (
    BacktestRecord,
    rolling_origin_cutoffs,
    score_by_horizon,
    summarise,
)


# --- cutoff selection ----------------------------------------------------------

def _dates(n: int, start: str = "2025-01-01") -> pd.DatetimeIndex:
    return pd.date_range(start, periods=n, freq="D")


def test_every_cutoff_leaves_a_full_horizon_of_actuals():
    dates = _dates(200)
    cutoffs = rolling_origin_cutoffs(dates, n_cutoffs=5, horizon=14, step=7)
    last = dates[-1].date()
    for c in cutoffs:
        assert (last - c).days >= 14, f"cutoff {c} has less than a full horizon after it"


def test_cutoffs_are_chronological_and_evenly_stepped():
    cutoffs = rolling_origin_cutoffs(_dates(200), n_cutoffs=5, horizon=14, step=7)
    assert cutoffs == sorted(cutoffs)
    gaps = {(b - a).days for a, b in zip(cutoffs, cutoffs[1:])}
    assert gaps == {7}


def test_requested_count_is_honoured_when_history_allows():
    assert len(rolling_origin_cutoffs(_dates(300), n_cutoffs=10, horizon=14, step=7)) == 10


def test_short_history_yields_fewer_cutoffs_rather_than_invalid_ones():
    # 80 days cannot support 10 cutoffs stepped by 7 with a 14-day horizon and
    # a 60-day minimum training window. Returning fewer is correct; returning
    # cutoffs that train on nothing is not.
    cutoffs = rolling_origin_cutoffs(_dates(80), n_cutoffs=10, horizon=14, step=7, min_train_days=60)
    assert len(cutoffs) < 10
    for c in cutoffs:
        assert (c - _dates(80)[0].date()).days >= 60


def test_history_too_short_for_any_cutoff_returns_empty():
    assert rolling_origin_cutoffs(_dates(30), n_cutoffs=5, horizon=14, step=7) == []


# --- scoring -------------------------------------------------------------------

def _rec(horizon: int, actual: float, pred: float, p10: float, p90: float) -> BacktestRecord:
    return BacktestRecord(
        cutoff=dt.date(2026, 1, 1),
        forecast_date=dt.date(2026, 1, 1) + dt.timedelta(days=horizon),
        horizon=horizon,
        actual=actual,
        predicted=pred,
        p10=p10,
        p90=p90,
    )


def test_scores_are_grouped_by_horizon_not_pooled():
    records = [
        _rec(1, 100.0, 110.0, 90.0, 130.0),
        _rec(1, 100.0, 110.0, 90.0, 130.0),
        _rec(14, 100.0, 150.0, 90.0, 130.0),
    ]
    scored = score_by_horizon(records)

    assert set(scored) == {1, 14}
    assert scored[1].wape == pytest.approx(0.10)
    assert scored[14].wape == pytest.approx(0.50)
    assert scored[1].sample_size == 2
    assert scored[14].sample_size == 1


def test_bias_is_signed_and_relative():
    # Consistently 10% high.
    records = [_rec(1, 100.0, 110.0, 90.0, 130.0) for _ in range(5)]
    assert score_by_horizon(records)[1].bias == pytest.approx(0.10)

    # Consistently 20% low.
    records = [_rec(1, 100.0, 80.0, 60.0, 100.0) for _ in range(5)]
    assert score_by_horizon(records)[1].bias == pytest.approx(-0.20)


def test_coverage_counts_actuals_inside_the_band():
    records = [
        _rec(1, 100.0, 100.0, 90.0, 110.0),   # inside
        _rec(1, 100.0, 100.0, 90.0, 110.0),   # inside
        _rec(1, 200.0, 100.0, 90.0, 110.0),   # above
        _rec(1,  50.0, 100.0, 90.0, 110.0),   # below
    ]
    assert score_by_horizon(records)[1].coverage80 == pytest.approx(0.50)


def test_boundaries_count_as_covered():
    records = [_rec(1, 90.0, 100.0, 90.0, 110.0), _rec(1, 110.0, 100.0, 90.0, 110.0)]
    assert score_by_horizon(records)[1].coverage80 == pytest.approx(1.0)


def test_empty_records_score_to_nothing():
    assert score_by_horizon([]) == {}


def test_summary_pools_across_horizons_and_reports_the_spread():
    records = [_rec(1, 100.0, 110.0, 90.0, 130.0), _rec(14, 100.0, 150.0, 90.0, 130.0)]
    s = summarise(score_by_horizon(records))
    assert s["horizons"] == 2
    assert s["sample_size"] == 2
    assert s["wape_h1"] == pytest.approx(0.10)
    assert s["wape_worst"] == pytest.approx(0.50)


# --- the real train/forecast path ----------------------------------------------

def _synthetic(days: int = 420, seed: int = 4) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp("2026-06-30"), periods=days, freq="D")
    lift = np.where(dates.weekday.to_numpy() >= 5, 1.3, 1.0)
    revenue = (5000.0 * lift + rng.normal(0.0, 200.0, size=days)).clip(min=100.0)
    return pd.DataFrame({"date": dates, "revenue": revenue})


def test_train_accepts_injected_history_so_a_cutoff_can_be_simulated():
    """Without this the harness would have to monkeypatch production code."""
    from ml.models import revenue as revenue_model

    history = _synthetic()
    truncated = history[history["date"] <= pd.Timestamp("2026-03-31")]

    result = revenue_model.train("store-x", enriched=False, history=truncated)

    assert result is not None
    # Trained only on what existed at the cutoff.
    assert result.sample_size <= len(truncated)


def test_backtest_produces_records_for_every_horizon(monkeypatch):
    from ml import backtest as bt

    history = _synthetic()
    monkeypatch.setattr(bt, "load_daily_revenue", lambda store_id, lookback_days=540: history.copy())

    records = bt.backtest_revenue("store-x", n_cutoffs=2, horizon=7, step=14)

    assert records, "no records produced"
    assert {r.horizon for r in records} == set(range(1, 8))
    for r in records:
        assert r.actual is not None
        assert (r.forecast_date - r.cutoff).days == r.horizon


def test_backtest_never_scores_a_day_the_model_could_see(monkeypatch):
    """The whole point of a rolling origin. A leak here invalidates every number."""
    from ml import backtest as bt

    history = _synthetic()
    monkeypatch.setattr(bt, "load_daily_revenue", lambda store_id, lookback_days=540: history.copy())

    for r in bt.backtest_revenue("store-x", n_cutoffs=2, horizon=7, step=14):
        assert r.forecast_date > r.cutoff
