"""F2 — one definition of MAPE, and WAPE as the promotable scalar.

`train()` computed its own MAPE inline with `np.where(actuals == 0, 1e-6, ...)`.
A single zero-revenue day in the holdout therefore produced a per-row error term
around 1e5-1e9 and the mean stopped meaning anything — while
`ml.evaluation.metrics.mape` sitting next door masks zeros correctly.

That mattered because `should_promote_enriched` gates on
`enriched.mape <= baseline.mape * 0.97`. On any window containing a zero the
comparison was decided by which model happened to miss the zero day by less.

These tests pin the two properties that stop it recurring: the reported metric
IS the shared one, and WAPE — scale-free and defined at zero — travels on the
result so gates never have to reach for MAPE at all.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.evaluation import metrics
from ml.models import revenue as revenue_model


def _history_with_a_closed_day(days: int = 400, seed: int = 11) -> pd.DataFrame:
    """A clean series whose second-to-last day is a genuine zero.

    The 80/10/10 split puts the tail in the holdout, so the zero lands in the
    rows `train()` scores itself on.
    """
    rng = np.random.default_rng(seed)
    dates = pd.date_range(end=pd.Timestamp(dt.date(2026, 4, 30)), periods=days, freq="D")
    weekday_lift = np.where(dates.weekday.to_numpy() >= 5, 1.25, 1.0)
    revenue = 4500.0 * weekday_lift + rng.normal(0.0, 180.0, size=days)
    revenue = revenue.clip(min=100.0)
    revenue[-2] = 0.0  # closed for a holiday
    return pd.DataFrame({"date": dates, "revenue": revenue})


@pytest.fixture
def closed_day_history(monkeypatch):
    history = _history_with_a_closed_day()
    monkeypatch.setattr(
        revenue_model,
        "load_daily_revenue",
        lambda store_id, lookback_days=540: history.copy(),
    )
    return history


def test_reported_mape_is_the_shared_metric(closed_day_history):
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None

    expected = metrics.mape(result.holdout_y_true, result.holdout_y_pred)
    assert expected is not None
    assert result.mape == pytest.approx(expected)


def test_a_zero_revenue_day_does_not_detonate_the_reported_mape(closed_day_history):
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None
    # Under the 1e-6 substitution this was ~1e5 or larger. A daily-revenue model
    # on a clean synthetic series should land far below 100% relative error.
    assert result.mape < 1.0, f"MAPE blew up on a zero actual: {result.mape}"


def test_train_result_carries_wape(closed_day_history):
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None

    expected = metrics.wape(result.holdout_y_true, result.holdout_y_pred)
    assert expected is not None
    assert result.wape == pytest.approx(expected)
    assert 0.0 <= result.wape < 1.0
