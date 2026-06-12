"""Horizon-aware widening of the conformal prediction interval (incident #38).

The conformal wrapper (MAPIE method="base") emits a *constant* half-width for
every row, so without widening all 14 forecast horizons share one interval even
though iterative multi-step error compounds — long horizons then under-cover
(observed 80% coverage ~0.60). These tests pin the widening contract:

  * day-1 (a true 1-step forecast) keeps the raw conformal width, and
  * each subsequent horizon's width grows by exactly 1 + k*(offset-1).
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.models import revenue as revenue_model


def _synthetic_history(days: int = 360, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    end = dt.date(2026, 4, 30)
    dates = pd.date_range(end=pd.Timestamp(end), periods=days, freq="D")
    weekday = dates.weekday.to_numpy()
    weekday_lift = np.where(weekday >= 5, 1.25, 1.0)
    trend = np.linspace(1.0, 1.2, days)
    revenue = 4500.0 * weekday_lift * trend + rng.normal(0.0, 180.0, days)
    return pd.DataFrame({"date": dates, "revenue": revenue.clip(min=100.0)})


@pytest.fixture
def patched_loaders(monkeypatch):
    history = _synthetic_history()
    monkeypatch.setattr(
        revenue_model, "load_daily_revenue", lambda store_id, lookback_days=540: history.copy()
    )
    return history


def test_conformal_intervals_widen_monotonically_with_horizon(patched_loaders):
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None and "conformal" in result.flavor

    rows = revenue_model.forecast("store-test", result, horizon_days=14)
    widths = [r.p90 - r.p10 for r in rows]

    # Strictly increasing across the horizon (no clamping at this revenue scale).
    for prev, cur in zip(widths, widths[1:]):
        assert cur > prev, f"width should grow with horizon: {widths}"

    # Day-1 is a 1-step forecast — its width is the raw conformal width, and
    # every later horizon scales by exactly 1 + k*(offset-1).
    k = revenue_model.HORIZON_WIDENING_PER_DAY
    for i, w in enumerate(widths):
        offset = i + 1
        expected_ratio = 1.0 + k * (offset - 1)
        assert w / widths[0] == pytest.approx(expected_ratio, rel=1e-6)
