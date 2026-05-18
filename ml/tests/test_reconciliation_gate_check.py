"""Tests for the 7-day reconciliation-health gate."""
from __future__ import annotations

from unittest.mock import MagicMock

from ml.evaluation.reconciliation_gate_check import (
    gate_reconciliation_post_median,
    RECONCILIATION_TARGET,
)


def _mk_conn(rows):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.return_value = rows
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn


def test_passes_when_all_7_days_below_15_percent():
    rows = [(0.12,), (0.10,), (0.11,), (0.13,), (0.09,), (0.14,), (0.11,)]
    passed, detail = gate_reconciliation_post_median(_mk_conn(rows))
    assert passed, detail
    assert "7/7" in detail


def test_fails_when_any_day_above_15_percent():
    rows = [(0.12,), (0.18,), (0.11,)] + [(0.10,)] * 4
    passed, detail = gate_reconciliation_post_median(_mk_conn(rows))
    assert not passed


def test_fails_when_fewer_than_7_rows():
    rows = [(0.10,), (0.11,)]
    passed, detail = gate_reconciliation_post_median(_mk_conn(rows))
    assert not passed
    assert "insufficient_window" in detail


def test_target_threshold_locked_at_fifteen_percent():
    assert RECONCILIATION_TARGET == 0.15
