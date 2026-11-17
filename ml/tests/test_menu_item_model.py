"""Regression test for the conformal-wrapped menu-item model.

Stubs the daily-quantity loader so the full train/forecast pipeline runs
against a synthetic 365-day series for one SKU. Asserts conformal wrapping
is in effect and a separately-tested short-history path opts into the
fallback flavor.
"""
from __future__ import annotations

import datetime as dt

import numpy as np
import pandas as pd
import pytest

from ml.models import menu_item as menu_item_model


def _synthetic_qty(days: int = 365, seed: int = 11) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    end = dt.date(2026, 4, 30)
    dates = pd.date_range(end=pd.Timestamp(end), periods=days, freq="D")
    weekday = dates.weekday.to_numpy()
    weekday_lift = np.where(weekday >= 5, 1.4, 1.0)
    base = 12.0
    noise = rng.normal(loc=0.0, scale=2.5, size=days)
    qty = (base * weekday_lift + noise).clip(min=0.0).round()
    return pd.DataFrame({"date": dates, "qty": qty.astype(float)})


@pytest.fixture
def patched_loader(monkeypatch):
    df = _synthetic_qty()
    monkeypatch.setattr(menu_item_model, "load_daily_quantity", lambda s, i: df.copy())
    return df


def test_train_and_forecast_uses_conformal(patched_loader):
    result = menu_item_model.train("store-test", "Burger")
    assert result is not None
    assert "conformal" in result.flavor, f"expected conformal flavor, got {result.flavor!r}"

    rows = menu_item_model.forecast("store-test", "Burger", result, horizon_days=7)
    assert len(rows) == 7
    for row in rows:
        assert row.predicted_qty >= 0.0
        assert row.p10 <= row.predicted_qty <= row.p90
        assert row.p90 > row.p10  # non-degenerate


def test_short_history_uses_fallback(monkeypatch):
    # Under the 150-day conformal floor we keep the legacy quantile-based
    # intervals — uncalibrated conformal bands on a tiny calib set would be
    # worse than the heuristic. The flavor must surface the fallback so the
    # evaluator can distinguish coverage-guaranteed runs.
    df = _synthetic_qty(days=120)
    monkeypatch.setattr(menu_item_model, "load_daily_quantity", lambda s, i: df)
    result = menu_item_model.train("store-test", "Burger")
    assert result is not None
    assert "fallback" in result.flavor, f"expected fallback flavor, got {result.flavor!r}"

    rows = menu_item_model.forecast("store-test", "Burger", result, horizon_days=3)
    for row in rows:
        assert row.p90 > row.p10


def test_below_minimum_history_returns_none(monkeypatch):
    df = _synthetic_qty(days=30)
    monkeypatch.setattr(menu_item_model, "load_daily_quantity", lambda s, i: df)
    assert menu_item_model.train("store-test", "Burger") is None


# --- run_menu_items_for_store: short history vs. a real failure ------------

def _run_menu_items(train_side_effect):
    from unittest.mock import patch as _patch
    from ml import run_nightly

    closed: dict = {}

    def _close(run_id, **kwargs):
        closed.update(kwargs)

    with _patch.object(run_nightly, "_open_run", return_value="run-1"), \
         _patch.object(run_nightly, "_close_run", side_effect=_close), \
         _patch.object(run_nightly, "load_top_items", return_value=["Fries", "Slider", "Shake"]), \
         _patch.object(run_nightly, "train_menu_item", side_effect=train_side_effect):
        result = run_nightly.run_menu_items_for_store("store-vnys", "v1")
    return result, closed


def test_every_item_under_60_days_reads_as_insufficient_history():
    result, closed = _run_menu_items(lambda store, item: None)
    assert result["reason"] == "insufficient_history"
    assert result["failed_count"] == 3
    # operator_gate_check Gate 1 matches this text to say "not enough history yet".
    assert closed["error"].startswith("insufficient_history")
    assert closed["status"] == "FAILED"


def test_an_item_that_raised_keeps_all_items_failed():
    def train(store, item):
        if item == "Slider":
            raise RuntimeError("boom")
        return None

    result, closed = _run_menu_items(train)
    assert result["reason"] == "all_items_failed"
    assert closed["error"] == "all_items_failed (3)"
