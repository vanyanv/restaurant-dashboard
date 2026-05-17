"""Tests for the --as-of mode of operator_gate_check.

Verifies that:
- Gates 1/2/3 thread the supplied target_date through their SQL parameters
  (windowEnd, train_cutoff, coverage window).
- main() with --as-of skips JobRun side effects entirely.
- main() without --as-of opens/closes a JobRun row as before.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, timedelta
from unittest import mock

import pytest

from ml.evaluation import operator_gate_check as ogc


class _FakeCursor:
    """Captures executed SQL + parameters; returns canned rows by call index."""

    def __init__(self, canned_results: list[list[tuple]]):
        self._canned = list(canned_results)
        self.calls: list[tuple[str, tuple | None]] = []

    def execute(self, sql, params=None):
        self.calls.append((sql, params))

    def fetchall(self):
        return self._canned.pop(0) if self._canned else []

    def fetchone(self):
        rows = self._canned.pop(0) if self._canned else []
        return rows[0] if rows else None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


class _FakeConn:
    def __init__(self, canned_results: list[list[tuple]]):
        self.cursor_obj = _FakeCursor(canned_results)

    def cursor(self):
        return self.cursor_obj


def _store_row(name: str, target: str, rows_today: int, is_trainable: bool):
    return (f"store-{name}", name, target, rows_today, is_trainable)


def test_gate1_passes_target_date_into_window_end_and_train_cutoff():
    target = date(2026, 5, 14)
    # One trainable store with 1 row for each target.
    canned = [[
        _store_row("alpha", "REVENUE", 1, True),
        _store_row("alpha", "BUSY_HOURS", 1, True),
        _store_row("alpha", "MENU_ITEM", 1, True),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert ok, detail
    sql, params = conn.cursor_obj.calls[0]
    # Params order: (train_cutoff, target_date, window_end)
    train_cutoff, td, window_end = params
    assert train_cutoff == target - timedelta(days=ogc._WINDOW_DAYS)
    assert td == target
    assert window_end == target - timedelta(days=1)


def test_gate1_fails_when_trainable_pair_missing_for_target_date():
    target = date(2026, 5, 14)
    canned = [[
        _store_row("alpha", "REVENUE", 1, True),
        _store_row("alpha", "BUSY_HOURS", 0, True),  # missing row
        _store_row("alpha", "MENU_ITEM", 1, True),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert not ok
    assert "missing for windowEnd=2026-05-13" in detail


def test_gate1_skips_non_trainable_pairs_without_failing():
    target = date(2026, 5, 14)
    canned = [[
        _store_row("alpha", "REVENUE", 1, True),
        _store_row("beta", "REVENUE", 0, False),  # no recent training — skipped
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert ok, detail
    assert "skipped" in detail


def test_gate2_window_ends_at_target_date():
    target = date(2026, 5, 14)
    canned = [[("REVENUE", 2, 5), ("BUSY_HOURS", 1, 4)]]
    conn = _FakeConn(canned)

    ok, _ = ogc.gate2_seasonal_naive_fired(conn, target)

    assert ok
    _, params = conn.cursor_obj.calls[0]
    # Params: (ilike_new, ilike_old, cutoff, target_date)
    ilike_new, ilike_old, cutoff, td = params
    assert ilike_new == "%seasonal-naive%"
    assert ilike_old == "%vs naive%"
    assert cutoff == target - timedelta(days=ogc._WINDOW_DAYS)
    assert td == target


def test_gate2_fails_when_zero_mentions_in_window():
    target = date(2026, 5, 14)
    canned = [[("REVENUE", 0, 5), ("BUSY_HOURS", 0, 4)]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate2_seasonal_naive_fired(conn, target)

    assert not ok
    assert "0/5" in detail or "0/4" in detail


def test_gate3_window_uses_window_end_around_target_date():
    target = date(2026, 5, 14)
    # Warming-up store (max_sample < 14) — silent pass.
    canned = [[("alpha", 0.80, 5, 7)]]
    conn = _FakeConn(canned)

    strict, detail, accept = ogc.gate3_revenue_coverage(conn, target)

    assert strict and accept
    assert "warming up" in detail
    _, params = conn.cursor_obj.calls[0]
    lo, hi = params
    assert lo == target - timedelta(days=ogc._WINDOW_DAYS)
    assert hi == target - timedelta(days=1)


def test_gate3_strict_pass_inside_target_band():
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.80, 14, 14)]]  # sample large enough — exercised
    conn = _FakeConn(canned)

    strict, detail, accept = ogc.gate3_revenue_coverage(conn, target)

    assert strict and accept, detail


def test_gate3_accept_band_only_when_drift():
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.77, 14, 14)]]  # outside strict, inside accept
    conn = _FakeConn(canned)

    strict, _, accept = ogc.gate3_revenue_coverage(conn, target)

    assert not strict
    assert accept


def test_gate3_fails_when_outside_accept_band():
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.60, 14, 14)]]
    conn = _FakeConn(canned)

    strict, _, accept = ogc.gate3_revenue_coverage(conn, target)

    assert not strict
    assert not accept


def test_main_as_of_skips_jobrun_writes():
    """--as-of must not call _open_job_run or _close_job_run."""
    with (
        mock.patch.object(ogc, "_open_job_run") as open_mock,
        mock.patch.object(ogc, "_close_job_run") as close_mock,
        mock.patch.object(ogc, "_run_checks", return_value=(0, {})) as run_mock,
    ):
        rc = ogc.main(["--as-of", "2026-05-12"])

    assert rc == 0
    open_mock.assert_not_called()
    close_mock.assert_not_called()
    assert run_mock.call_args.args[0] == date(2026, 5, 12)


def test_main_today_mode_writes_jobrun():
    """No flag: opens and closes a JobRun row, just like the cron."""
    with (
        mock.patch.object(ogc, "_open_job_run", return_value="run-id") as open_mock,
        mock.patch.object(ogc, "_close_job_run") as close_mock,
        mock.patch.object(ogc, "_run_checks", return_value=(0, {"x": 1})),
    ):
        rc = ogc.main([])

    assert rc == 0
    open_mock.assert_called_once()
    close_mock.assert_called_once()
    assert close_mock.call_args.kwargs["status"] == "SUCCESS"
