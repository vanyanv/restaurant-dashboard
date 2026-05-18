"""Tests for the MinTrace reconciliation pipeline.

We test:
  1. Closed-form behavior on a known-consistent hierarchy (ok=True + >=3 writes).
  2. Fail-soft on reconciler exception (returns ok=False + reason).
  3. Auto-fallback to ols when Y_df is empty.
  4. SQL writers are idempotent (UPDATE-keyed or ON CONFLICT).
"""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest


def _consistent_forecast_frame():
    """A small consistent hierarchy: 2 items, 1 category, 1 day.
    Revenue = Σ category = Σ items, all aligned at 100."""
    today = dt.date(2026, 5, 27)
    return {
        "revenue": [(today, 100.0, 80.0, 120.0)],
        "categories": {
            "Sandwiches": [(today, 100.0, 80.0, 120.0)],
        },
        "items": {
            "Bacon Eddy":  [(today, 5.0, 4.0, 6.0)],
            "Cheesy Eddy": [(today, 5.0, 4.0, 6.0)],
        },
        "prices": {"Bacon Eddy": 10.0, "Cheesy Eddy": 10.0},
        "item_to_category": {"Bacon Eddy": "Sandwiches", "Cheesy Eddy": "Sandwiches"},
    }


def _fitted_y_df_for_consistent_frame():
    """Long-format insample fitted values matching the hierarchy. 28 days of
    history per series, plus mild noise so mint_shrink's covariance estimator
    has non-degenerate residuals."""
    rng = np.random.default_rng(seed=42)
    dates = pd.date_range(end=pd.Timestamp("2026-05-26"), periods=28, freq="D")
    rows = []
    for uid, base in [
        ("revenue", 100.0),
        ("Sandwiches", 100.0),
        ("Bacon Eddy", 50.0),
        ("Cheesy Eddy", 50.0),
    ]:
        noise = rng.normal(0, 1.0, size=len(dates))
        for ds, n in zip(dates, noise):
            rows.append({"unique_id": uid, "ds": ds, "y": base + n})
    return pd.DataFrame(rows)


def test_reconcile_consistent_hierarchy_returns_ok():
    from ml.reconciliation.reconcile import (
        reconcile_store_hierarchy, ReconcileResult,
    )
    forecast = _consistent_forecast_frame()
    y_df = _fitted_y_df_for_consistent_frame()

    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    result = reconcile_store_hierarchy(
        conn, store_id="store-hwd",
        forecast_frame=forecast, y_df=y_df, method="mint_shrink",
    )

    assert isinstance(result, ReconcileResult)
    assert result.ok, result.warning
    # Expect >=1 write for each level: revenue (1) + category (1) + items (2) = 4.
    assert result.rows_written >= 3


def test_reconcile_falls_soft_on_reconciler_exception(monkeypatch):
    from ml.reconciliation import reconcile as recmod
    from ml.reconciliation.reconcile import reconcile_store_hierarchy

    def boom(*args, **kwargs):
        raise RuntimeError("singular matrix in MinTrace")
    monkeypatch.setattr(recmod, "_run_min_trace", boom)

    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    result = reconcile_store_hierarchy(
        conn, store_id="store-hwd",
        forecast_frame=_consistent_forecast_frame(),
        y_df=_fitted_y_df_for_consistent_frame(),
        method="ols",  # use ols so the mint_shrink->ols retry path isn't tickled here
    )
    assert not result.ok
    assert "singular" in result.warning.lower() or "runtimeerror" in result.warning.lower()


def test_reconcile_falls_back_to_ols_when_y_df_empty(monkeypatch):
    """mint_shrink needs Y_df with insample residuals. When Y_df is empty,
    we should fall back to method='ols' automatically and still produce writes."""
    from ml.reconciliation import reconcile as recmod
    from ml.reconciliation.reconcile import reconcile_store_hierarchy

    calls = []
    original = recmod._run_min_trace
    def spy(S_df, tags, y_hat_df, y_df, method):
        calls.append(method)
        return original(S_df, tags, y_hat_df, y_df, method)
    monkeypatch.setattr(recmod, "_run_min_trace", spy)

    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    result = reconcile_store_hierarchy(
        conn, store_id="store-hwd",
        forecast_frame=_consistent_forecast_frame(),
        y_df=pd.DataFrame(columns=["unique_id", "ds", "y"]),
        method="mint_shrink",
    )
    # Should have called ols (either directly or after the mint_shrink->ols swap).
    assert "ols" in calls
    assert result.ok, result.warning
    assert result.method == "ols"


def test_reconcile_sql_writers_have_idempotent_marker():
    """The three back-write SQL templates are idempotent - by UPDATE keyed on
    the row's natural identity (for ForecastDailyRevenue / ForecastMenuItem,
    which are written by the model trainer)."""
    from ml.reconciliation.reconcile import (
        _REVENUE_UPSERT_SQL, _CATEGORY_UPSERT_SQL, _ITEM_UPSERT_SQL,
    )
    for sql in (_REVENUE_UPSERT_SQL, _CATEGORY_UPSERT_SQL, _ITEM_UPSERT_SQL):
        assert "UPDATE" in sql or "ON CONFLICT" in sql
