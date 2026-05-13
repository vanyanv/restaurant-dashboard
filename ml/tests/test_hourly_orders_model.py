"""Regression test for the conformal-wrapped hourly-orders model.

Stubs the DB loaders so the full train/forecast pipeline runs against a
synthetic 90-day hourly series with a believable daypart curve. Asserts
conformal wrapping is in effect (`flavor` carries `conformal`) and that
each forecast row has a non-degenerate p10/p90.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.models import hourly_orders as hourly_model


def _daypart_curve() -> np.ndarray:
    """Roughly bimodal lunch/dinner curve, peak ~hour 12 and ~hour 19."""
    hours = np.arange(24)
    lunch = 14.0 * np.exp(-0.5 * ((hours - 12) / 2.0) ** 2)
    dinner = 18.0 * np.exp(-0.5 * ((hours - 19) / 2.5) ** 2)
    base = 0.5
    return base + lunch + dinner


def _synthetic_hourly(days: int = 90, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    end = dt.date(2026, 4, 30)
    dates = pd.date_range(end=pd.Timestamp(end), periods=days, freq="D")
    curve = _daypart_curve()
    rows = []
    for d in dates:
        weekday_lift = 1.25 if d.weekday() >= 5 else 1.0
        for h in range(24):
            mean = curve[h] * weekday_lift
            orders = max(0.0, mean + rng.normal(scale=1.5))
            rows.append({
                "date": d,
                "hour": h,
                "orders": float(round(orders)),
                "net_sales": float(round(orders * 22.0, 2)),
            })
    return pd.DataFrame(rows)


def _synthetic_daily(hourly: pd.DataFrame) -> pd.DataFrame:
    g = hourly.groupby("date", as_index=False).agg(
        orders=("orders", "sum"),
        revenue=("net_sales", "sum"),
    )
    return g


@pytest.fixture
def patched_loaders(monkeypatch):
    hourly = _synthetic_hourly()
    daily = _synthetic_daily(hourly)
    monkeypatch.setattr(hourly_model, "load_hourly_orders", lambda store_id: hourly.copy())
    monkeypatch.setattr(hourly_model, "load_daily_context", lambda store_id: daily.copy())
    monkeypatch.setattr(
        hourly_model,
        "load_harri_features",
        lambda store_id: pd.DataFrame(),
    )
    return hourly


def test_train_and_forecast_uses_conformal(patched_loaders):
    result = hourly_model.train("store-test", enriched=False)
    assert result is not None
    assert "conformal" in result.flavor, f"expected conformal flavor, got {result.flavor!r}"

    rows = hourly_model.forecast("store-test", result, horizon_days=2)
    assert len(rows) == 2 * 24
    for row in rows:
        assert row.predicted_orders >= 0.0
        assert row.p10 <= row.predicted_orders <= row.p90
        assert row.p90 > row.p10  # non-degenerate


def test_short_history_returns_none(monkeypatch):
    short = _synthetic_hourly(days=30)
    monkeypatch.setattr(hourly_model, "load_hourly_orders", lambda store_id: short)
    monkeypatch.setattr(hourly_model, "load_daily_context", lambda store_id: _synthetic_daily(short))
    monkeypatch.setattr(hourly_model, "load_harri_features", lambda store_id: pd.DataFrame())
    assert hourly_model.train("store-test", enriched=False) is None
