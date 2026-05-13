"""Regression test for the conformal-wrapped daily-revenue model.

Stubs the DB-facing data loader so we can exercise the full train/forecast
pipeline against a synthetic 540-day revenue series. Asserts the conformal
plumbing actually runs (`flavor` carries `conformal`) and that p10 < p90.
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
    base = 4500.0
    noise = rng.normal(loc=0.0, scale=180.0, size=days)
    revenue = base * weekday_lift * trend + noise
    return pd.DataFrame({"date": dates, "revenue": revenue.clip(min=100.0)})


@pytest.fixture
def patched_loaders(monkeypatch):
    history = _synthetic_history()
    monkeypatch.setattr(revenue_model, "load_daily_revenue", lambda store_id, lookback_days=540: history.copy())
    return history


def test_train_and_forecast_uses_conformal(patched_loaders):
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None
    # Conformal wrapping must be the active path (not the legacy residual-std math).
    assert "conformal" in result.flavor, f"expected conformal flavor, got {result.flavor!r}"

    rows = revenue_model.forecast("store-test", result, horizon_days=7)
    assert len(rows) == 7
    for row in rows:
        assert row.predicted_revenue >= 0.0
        assert row.p10 <= row.predicted_revenue <= row.p90
        # Non-degenerate interval.
        assert row.p90 > row.p10


def test_short_history_returns_none(monkeypatch):
    monkeypatch.setattr(
        revenue_model,
        "load_daily_revenue",
        lambda store_id, lookback_days=540: _synthetic_history(days=30),
    )
    assert revenue_model.train("store-test", enriched=False) is None


def test_fallback_flavor_when_calibration_window_too_small(monkeypatch):
    # ~30 valid feature rows after the 90-day rolling drop; 80/10/10 leaves
    # only 3 rows for calibration — below the conformal-coverage floor — so
    # we should fall back to residual-std intervals and tag the flavor.
    monkeypatch.setattr(
        revenue_model,
        "load_daily_revenue",
        lambda store_id, lookback_days=540: _synthetic_history(days=120),
    )
    result = revenue_model.train("store-test", enriched=False)
    assert result is not None
    assert "fallback" in result.flavor, f"expected fallback flavor, got {result.flavor!r}"
    rows = revenue_model.forecast("store-test", result, horizon_days=3)
    for row in rows:
        assert row.p90 > row.p10
