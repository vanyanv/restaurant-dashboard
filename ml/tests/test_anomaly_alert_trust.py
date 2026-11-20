"""Alert trust fixes: the z-score fallback, the menu-item partial day, and
z-score explanations that say "usual" rather than "forecast"."""
from __future__ import annotations

import datetime as dt
from contextlib import contextmanager

import pandas as pd
import pytest


def test_menu_item_zscore_trims_the_day_still_being_written(monkeypatch):
    """Today's half-written count must not be scored against full days."""
    from ml.anomaly import zscore

    dates = pd.date_range("2026-10-01", periods=40, freq="D")
    qty = [20.0 + (i % 3) for i in range(39)] + [2.0]  # last day: lunch only
    frame = pd.DataFrame({"date": dates.date, "itemName": "Shake", "qty": qty})

    @contextmanager
    def fake_connect():
        yield object()

    monkeypatch.setattr(zscore, "connect", fake_connect)
    monkeypatch.setattr(zscore.pd, "read_sql_query", lambda *a, **k: frame.copy())
    # Coverage says the last date only reached 13:00; closing is later.
    last = dates[-1].date()
    coverage = {d.date(): 23 for d in dates[:-1]}
    coverage[last] = 13
    monkeypatch.setattr(zscore, "load_hourly_coverage", lambda *a, **k: coverage)

    out = zscore.detect_menu_item_anomalies("store-x", ["Shake"])
    assert all(a.occurred_on != last for a in out), "scored the partial day"


def test_zscore_explanations_compare_to_usual_not_forecast(monkeypatch):
    from ml.anomaly import zscore

    dates = pd.date_range("2026-06-01", periods=60, freq="D")
    revenue = [5000.0 + (i % 5) * 10 for i in range(59)] + [1000.0]
    monkeypatch.setattr(
        zscore, "load_daily_revenue",
        lambda *a, **k: pd.DataFrame({"date": dates, "revenue": revenue}),
    )
    out = zscore.detect_revenue_anomalies("store-x")
    assert len(out) == 1
    text = out[0].explanation
    assert text is not None
    assert "usual" in text and "forecast" not in text
    assert "$1,000" in text


def _nightly_with(monkeypatch, observations):
    from ml import run_nightly

    calls = {"zscore": 0}

    def fake_zscore(store_id):
        calls["zscore"] += 1
        return []

    monkeypatch.setattr(run_nightly, "load_reconciled_observations", lambda *a, **k: observations)
    monkeypatch.setattr(run_nightly, "detect_revenue_anomalies", fake_zscore)
    monkeypatch.setattr(run_nightly, "detect_menu_item_anomalies", lambda *a, **k: [])
    monkeypatch.setattr(run_nightly, "load_top_items", lambda *a, **k: [])
    monkeypatch.setattr(run_nightly, "write_anomalies", lambda store_id, rows: len(rows))
    result = run_nightly.run_anomaly_detection_for_store("store-x")
    return result, calls


def test_a_quiet_window_with_forecasts_does_not_fall_back_to_zscore(monkeypatch):
    from ml.anomaly.interval import IntervalObservation

    quiet = [
        IntervalObservation(
            occurred_on=dt.date(2026, 11, 1) + dt.timedelta(days=i),
            actual=5000.0, predicted=5000.0, p10=4500.0, p90=5500.0,
        )
        for i in range(10)
    ]
    result, calls = _nightly_with(monkeypatch, quiet)
    assert result["ok"] is True
    assert result["revenue_detector"] == "interval"
    assert result["revenue_count"] == 0
    assert calls["zscore"] == 0


def test_a_store_with_no_reconciled_forecasts_falls_back(monkeypatch):
    result, calls = _nightly_with(monkeypatch, [])
    assert result["revenue_detector"] == "zscore"
    assert calls["zscore"] == 1
