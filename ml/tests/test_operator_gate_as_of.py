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


def _store_row(
    name: str,
    target: str,
    rows_today: int,
    is_trainable: bool,
    stage: str = "ready",
):
    """A Gate 1 row. `stage` is the store's lifecycle stage, which together
    with the target decides whether a pair with no SUCCEEDED training is an
    outage or the design."""
    return (f"store-{name}", name, target, rows_today, is_trainable, stage)


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


def test_gate1_skips_a_pre_open_store_on_every_target():
    """`run_nightly.main` trains nothing at all for a pre_open store, so every
    untrained pair there is the design. Glendale and Van Nuys sat in exactly
    this state while the gate ran."""
    target = date(2026, 5, 14)
    canned = [[
        _store_row("alpha", "REVENUE", 1, True),
        _store_row("beta", "REVENUE", 0, False, stage="pre_open"),
        _store_row("beta", "BUSY_HOURS", 0, False, stage="pre_open"),
        _store_row("beta", "MENU_ITEM", 0, False, stage="pre_open"),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert ok, detail
    assert "not trained (stage `pre_open`)" in detail


def test_gate1_fails_when_a_ready_store_has_no_successful_training():
    """The same missing training at a `ready` store is the nightly job failing
    for it. Until 2026-09-19 this took the skip path and the gate passed."""
    target = date(2026, 5, 14)
    canned = [[
        _store_row("alpha", "REVENUE", 1, True),
        _store_row("alpha", "BUSY_HOURS", 0, False, stage="ready"),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert not ok
    assert "no SUCCEEDED training" in detail
    assert "BUSY_HOURS" in detail


def test_gate1_fails_when_a_warming_up_store_stops_training_revenue():
    """main() DOES train REVENUE for a warming_up store — natively, so the
    warming_up -> ready gate has something to evaluate. Reading the stage as a
    bare ready / not-ready split skipped it anyway, which left a warming_up
    store's revenue outage as silent as a ready store's had been."""
    target = date(2026, 5, 14)
    canned = [[
        _store_row("beta", "REVENUE", 0, False, stage="warming_up"),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert not ok
    assert "no SUCCEEDED training" in detail
    assert "warming_up" in detail


def test_gate1_still_skips_the_targets_a_warming_up_store_never_trains():
    """Only REVENUE is expected at warming_up; demanding the other two would
    be guaranteed-to-fail noise, which is what the skip exists to avoid."""
    target = date(2026, 5, 14)
    canned = [[
        _store_row("beta", "REVENUE", 1, True, stage="warming_up"),
        _store_row("beta", "BUSY_HOURS", 0, False, stage="warming_up"),
        _store_row("beta", "MENU_ITEM", 0, False, stage="warming_up"),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert ok, detail
    assert "not trained (stage `warming_up`)" in detail


def test_gate1_treats_an_unknown_lifecycle_stage_as_ready():
    """A stage added to the schema but not to _STAGE_TARGETS should make the
    gate noisy rather than silent — silence is the failure it exists to end."""
    target = date(2026, 5, 14)
    canned = [[
        _store_row("beta", "REVENUE", 0, False, stage="mothballed"),
    ]]
    conn = _FakeConn(canned)

    ok, detail = ogc.gate1_eval_rows_today(conn, target)

    assert not ok
    assert "no SUCCEEDED training" in detail


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
    canned = [[("REVENUE", 0, 5), ("BUSY_HOURS", 0, 4)]]  # both gated, both silent
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
    # Second rowset: post-epoch reconciled counts, i.e. how many of those
    # observations the CURRENT model generation produced. Enough here, so
    # the store is genuinely band-checked rather than deferred.
    canned = [[("alpha", 0.80, 14, 14)], [("alpha", 14, 0.80)]]
    conn = _FakeConn(canned)

    strict, detail, accept = ogc.gate3_revenue_coverage(conn, target)

    assert strict and accept, detail


def test_gate3_accept_band_only_when_drift():
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.77, 14, 14)], [("alpha", 14, 0.77)]]  # outside strict, inside accept
    conn = _FakeConn(canned)

    strict, _, accept = ogc.gate3_revenue_coverage(conn, target)

    assert not strict
    assert accept


def test_gate3_fails_when_outside_accept_band():
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.60, 14, 14)], [("alpha", 14, 0.60)]]
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


def test_gate3_defers_when_the_current_model_generation_is_thin():
    """26 pooled observations, 2 from the model running today — the shape of the
    2026-08-19 model change. The gate must defer, not call the new model BROKEN."""
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.648, 7, 26)], [("alpha", 2, 0.648)]]
    conn = _FakeConn(canned)

    strict, detail, accept = ogc.gate3_revenue_coverage(conn, target)

    assert strict and accept, detail
    assert "warming up" in detail and "BROKEN" not in detail
    assert "0.648" in detail  # still reported, not hidden


def test_gate3_treats_a_store_absent_from_post_epoch_counts_as_zero():
    """A store that has produced no post-epoch reconciled rows at all does not
    appear in the counts query; it must default to 0, not KeyError."""
    target = date(2026, 5, 14)
    canned = [[("alpha", 0.60, 14, 14)], []]
    conn = _FakeConn(canned)

    strict, detail, accept = ogc.gate3_revenue_coverage(conn, target)

    assert strict and accept, detail
    assert "warming up" in detail
