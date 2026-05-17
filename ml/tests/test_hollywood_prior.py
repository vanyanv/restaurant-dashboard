"""Tests for the Hollywood-prior transfer scalar computation."""
from __future__ import annotations

import pytest

from ml.transfer.hollywood_prior import (
    compute_transfer_scalar,
    widened_interval,
    INTERVAL_WIDEN_MULTIPLIER,
)


def test_compute_transfer_scalar_with_full_window_uses_ratio():
    # 14 days of new-store actuals averaging 1500; Hollywood same window avg 3000.
    new_actuals = [1500.0] * 14
    holly_actuals = [3000.0] * 14
    scalar = compute_transfer_scalar(
        new_store_actuals=new_actuals,
        hollywood_actuals_same_window=holly_actuals,
        initial_scalar=None,
    )
    assert scalar == pytest.approx(0.5)


def test_compute_transfer_scalar_under_threshold_uses_initial_scalar():
    # Only 3 actuals — below the 7-day floor; fall back to operator-set initial.
    scalar = compute_transfer_scalar(
        new_store_actuals=[1500.0, 1600.0, 1400.0],
        hollywood_actuals_same_window=[3000.0, 3000.0, 3000.0],
        initial_scalar=0.42,
    )
    assert scalar == 0.42


def test_compute_transfer_scalar_zero_actuals_uses_initial():
    scalar = compute_transfer_scalar(
        new_store_actuals=[],
        hollywood_actuals_same_window=[],
        initial_scalar=0.75,
    )
    assert scalar == 0.75


def test_compute_transfer_scalar_missing_initial_when_under_threshold_raises():
    with pytest.raises(ValueError, match="initial_scalar required"):
        compute_transfer_scalar(
            new_store_actuals=[1.0, 2.0],
            hollywood_actuals_same_window=[1.0, 2.0],
            initial_scalar=None,
        )


def test_compute_transfer_scalar_threshold_is_seven():
    # Exactly 7 days IS enough to compute the ratio.
    scalar = compute_transfer_scalar(
        new_store_actuals=[100.0] * 7,
        hollywood_actuals_same_window=[200.0] * 7,
        initial_scalar=0.0,
    )
    assert scalar == pytest.approx(0.5)


def test_compute_transfer_scalar_zero_hollywood_avg_falls_back():
    # If Hollywood window happens to be zero (closure?), divide-by-zero guard.
    scalar = compute_transfer_scalar(
        new_store_actuals=[100.0] * 14,
        hollywood_actuals_same_window=[0.0] * 14,
        initial_scalar=0.5,
    )
    assert scalar == 0.5


def test_widened_interval_multiplies_half_width_by_constant():
    point, p10, p90 = widened_interval(point=100.0, p10=80.0, p90=120.0)
    # Original half-width 20; widened half-width 30 (x1.5); center unchanged.
    assert INTERVAL_WIDEN_MULTIPLIER == pytest.approx(1.5)
    assert point == 100.0
    assert p10 == pytest.approx(70.0)
    assert p90 == pytest.approx(130.0)


def test_widened_interval_clamps_p10_at_zero():
    _, p10, _ = widened_interval(point=10.0, p10=8.0, p90=12.0)
    # Half-width 2 * 1.5 = 3 -> center 10 -> p10 = 7 (positive, unchanged).
    assert p10 == pytest.approx(7.0)
    # And a case that would go negative:
    _, p10_neg, _ = widened_interval(point=5.0, p10=0.0, p90=20.0)
    # Half-width 5 * 1.5 = 7.5 -> center 5 -> p10 would be -2.5; clamp to 0.
    assert p10_neg == 0.0


def test_widened_interval_passthrough_when_p10_or_p90_none():
    point, p10, p90 = widened_interval(point=50.0, p10=None, p90=60.0)
    assert (point, p10, p90) == (50.0, None, 60.0)


# --- writer tests (use psycopg2 mock cursor pattern from test_nightly_integration) ---

import datetime as dt
from unittest.mock import MagicMock

from ml.transfer.hollywood_prior import (
    write_transfer_forecasts_for_store,
    TransferWriteResult,
)


def _mk_cursor(rowsets: list[list[tuple]]):
    """Build a cursor whose successive fetchall()s return rowsets[i]."""
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.side_effect = rowsets
    cur.execute = MagicMock()
    return cur


def _mk_conn(cursors: list):
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    it = iter(cursors)
    conn.cursor.side_effect = lambda *a, **k: next(it)
    return conn


def test_write_transfer_forecasts_writes_revenue_rows_with_widened_intervals():
    """Hollywood has 1 day of native forecasts at $3000 (p10 $2800, p90 $3200).
    New store has 14 days of $1500 actuals so scalar = 0.5. After widening
    intervals by 1.5x: scaled p10 = 1400 -> widened p10 = 1500 - 1.5*(1500-1400) = 1350.
    """
    # cur 1 (load hollywood forecasts): one row (date, point, p10, p90).
    hollywood_rows = [(dt.date(2026, 5, 20), 3000.0, 2800.0, 3200.0)]
    # cur 2 (load new-store actuals):
    new_actuals = [(1500.0,)] * 14
    # cur 3 (load hollywood actuals):
    holly_actuals = [(3000.0,)] * 14
    # cur 4 (insert): no fetchall expected.
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()

    cursors = [
        _mk_cursor([hollywood_rows]),
        _mk_cursor([new_actuals]),
        _mk_cursor([holly_actuals]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)

    result = write_transfer_forecasts_for_store(
        conn,
        new_store_id="store-gln",
        hollywood_store_id="store-hwd",
        model_version="transfer-20260520",
        initial_scalar=0.5,
    )

    assert isinstance(result, TransferWriteResult)
    assert result.ok
    assert result.revenue_rows_written == 1
    assert result.scalar_used == pytest.approx(0.5)
    # Verify INSERT was called with 'transfer' literal in SQL.
    assert insert_cur.execute.call_count == 1
    sql, params = insert_cur.execute.call_args.args
    assert "'transfer'" in sql
    assert "ForecastDailyRevenue" in sql


def test_write_transfer_forecasts_fails_soft_when_hollywood_has_no_recent_forecasts():
    """If Hollywood has no recent forecasts, return ok=False with a warning."""
    cursors = [
        _mk_cursor([[]]),  # hollywood_rows empty
    ]
    conn = _mk_conn(cursors)

    result = write_transfer_forecasts_for_store(
        conn,
        new_store_id="store-gln",
        hollywood_store_id="store-hwd",
        model_version="transfer-20260520",
        initial_scalar=0.5,
    )

    assert not result.ok
    assert "hollywood_has_no_recent_forecasts" in result.warning


def test_write_transfer_forecasts_fails_soft_when_no_actuals_and_no_initial():
    """Under 7 actuals AND no initial_scalar -> ValueError surfaces as ok=False."""
    cursors = [
        _mk_cursor([[(dt.date(2026, 5, 20), 3000.0, 2800.0, 3200.0)]]),
        _mk_cursor([[(1500.0,)] * 3]),
        _mk_cursor([[(3000.0,)] * 3]),
    ]
    conn = _mk_conn(cursors)

    result = write_transfer_forecasts_for_store(
        conn,
        new_store_id="store-gln",
        hollywood_store_id="store-hwd",
        model_version="transfer-20260520",
        initial_scalar=None,
    )

    assert not result.ok
    assert "initial_scalar" in result.warning.lower()
