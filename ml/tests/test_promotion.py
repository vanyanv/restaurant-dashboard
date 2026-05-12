"""Tests for ml.evaluation.promotion.select_with_gate.

`select_with_gate` orchestrates the promotion decision: it computes the
seasonal-naive WAPE on the same holdout window the enriched/baseline
results were evaluated on, then calls `decide_promotion`. When the holdout
history is too short for a stable seasonal-naive (<7 days for daily,
<168 hours for hourly), it falls back to the legacy enriched-vs-baseline
gate and emits a warning in the returned reason.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

import numpy as np
import pandas as pd
import pytest

from ml.evaluation.promotion import select_with_gate


@dataclass
class _Result:
    """Minimal stand-in for TrainResult — only the fields the gate uses."""
    mape: float
    mae: float
    holdout_y_true: np.ndarray
    holdout_y_pred: np.ndarray
    flavor: str = "baseline-conformal"


def _daily_history(days: int = 60, seed: int = 1) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    end = dt.date(2026, 4, 30)
    dates = pd.date_range(end=pd.Timestamp(end), periods=days, freq="D")
    weekday = dates.weekday.to_numpy()
    base = 1000.0 + 200.0 * (weekday >= 5)
    noise = rng.normal(scale=50.0, size=days)
    return pd.DataFrame({"date": dates, "value": base + noise})


def test_enriched_promotes_when_beating_both_baselines():
    history = _daily_history(60)
    # Enriched predictions tightly track true values; baseline-XGB clearly worse;
    # seasonal-naive WAPE on the underlying weekly-seasonal series will also be
    # clearly worse than the near-perfect enriched fit.
    actuals = history["value"].to_numpy()[-14:]
    enriched_pred = actuals * 1.005  # ~0.5% off
    baseline_pred = actuals * 1.15   # ~15% off

    baseline = _Result(mape=0.15, mae=150.0, holdout_y_true=actuals, holdout_y_pred=baseline_pred)
    enriched = _Result(mape=0.005, mae=5.0, holdout_y_true=actuals, holdout_y_pred=enriched_pred,
                       flavor="weather-events-conformal")

    chosen, label, reason = select_with_gate(
        baseline=baseline,
        enriched=enriched,
        target="REVENUE",
        model_history=history,
    )
    assert chosen is enriched
    assert label == "promoted"
    assert "beats" in reason


def test_enriched_falls_back_when_seasonal_naive_too_close():
    history = _daily_history(60)
    actuals = history["value"].to_numpy()[-14:]
    # The strongly weekly-seasonal series makes seasonal-naive a tough
    # baseline. Compute it explicitly on the same window so we know its
    # WAPE precisely, then make enriched only marginally better.
    naive_pred = history["value"].to_numpy()[-21:-7]
    naive_resid = actuals - naive_pred
    naive_wape = float(np.sum(np.abs(naive_resid))) / float(np.sum(np.abs(actuals)))
    # Enriched only ~2% relative improvement vs seasonal-naive — below threshold.
    target_wape = naive_wape * 0.98
    # Construct enriched_pred whose WAPE equals target_wape, sharing the sign
    # pattern of `naive_resid` so the residuals scale linearly.
    enriched_pred = actuals - naive_resid * (target_wape / max(naive_wape, 1e-9))
    # Baseline-XGB clearly worse than enriched (so enriched-vs-baseline gate
    # would normally promote — the failure must come from the naive gate).
    baseline_pred = actuals * 1.20

    baseline = _Result(mape=0.20, mae=200.0, holdout_y_true=actuals, holdout_y_pred=baseline_pred)
    enriched = _Result(mape=target_wape, mae=20.0, holdout_y_true=actuals, holdout_y_pred=enriched_pred,
                       flavor="weather-events-conformal")

    chosen, label, _reason = select_with_gate(
        baseline=baseline,
        enriched=enriched,
        target="REVENUE",
        model_history=history,
    )
    assert chosen is baseline
    assert label in ("baseline_won", "gate_rejected")


def test_falls_back_to_old_gate_when_holdout_too_short():
    # Daily history with <7 days — seasonal-naive cannot be computed.
    short_history = _daily_history(5)
    actuals = short_history["value"].to_numpy()
    enriched_pred = actuals * 1.005
    baseline_pred = actuals * 1.15

    baseline = _Result(mape=0.15, mae=150.0, holdout_y_true=actuals, holdout_y_pred=baseline_pred)
    enriched = _Result(mape=0.005, mae=5.0, holdout_y_true=actuals, holdout_y_pred=enriched_pred,
                       flavor="weather-events-conformal")

    chosen, label, reason = select_with_gate(
        baseline=baseline,
        enriched=enriched,
        target="REVENUE",
        model_history=short_history,
    )
    # Old gate: enriched beats baseline on MAPE by way more than 3%, so it
    # promotes — but the reason should signal the fallback path.
    assert chosen is enriched
    assert label == "promoted"
    assert "fallback" in reason.lower() or "short" in reason.lower() or "seasonal" in reason.lower()


def test_enriched_none_returns_baseline():
    history = _daily_history(60)
    actuals = history["value"].to_numpy()[-14:]
    baseline = _Result(mape=0.10, mae=80.0, holdout_y_true=actuals,
                       holdout_y_pred=actuals * 1.10)
    chosen, label, _ = select_with_gate(
        baseline=baseline,
        enriched=None,
        target="REVENUE",
        model_history=history,
    )
    assert chosen is baseline
    assert label == "enriched_skipped"
