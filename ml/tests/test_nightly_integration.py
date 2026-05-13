"""Tests for ml.evaluation.nightly_integration.

`run_evaluation_pass` and `run_consistency_check` are the two entry points
the nightly pipeline calls per active store. Both take a live psycopg2
connection — we mock that with unittest.mock.MagicMock and assert on the
SQL/calls they make.
"""
from __future__ import annotations

import datetime as dt
import logging
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from ml.evaluation import nightly_integration as ni


def _mk_cursor_for_revenue(rows: list[tuple]) -> MagicMock:
    """Return a MagicMock cursor whose fetchall() yields `rows`."""
    cur = MagicMock()
    cur.fetchall.return_value = rows
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda self, *a: None
    return cur


def _mk_conn_with_rowsets(rowsets: list[list[tuple]]) -> MagicMock:
    """A MagicMock connection that hands out a fresh cursor per `cursor()` call,
    each cursor pre-loaded with the next rowset's fetchall() result."""
    cursors = []
    for rows in rowsets:
        c = MagicMock()
        c.fetchall.return_value = rows
        cursors.append(c)

    iter_cursors = iter(cursors)

    def cursor_factory(*args, **kwargs):
        try:
            nxt = next(iter_cursors)
        except StopIteration:
            nxt = MagicMock()
            nxt.fetchall.return_value = []
        cm = MagicMock()
        cm.__enter__ = lambda self, _c=nxt: _c
        cm.__exit__ = lambda self, *a: None
        return cm

    conn = MagicMock()
    conn.cursor.side_effect = cursor_factory
    return conn


def test_run_evaluation_pass_upserts_one_row_per_target():
    today = dt.date(2026, 5, 12)

    # Build mocked rowsets for the 3 fetches inside run_evaluation_pass.
    # Each fetch tuple shape is (forecastDate, predicted, actual, p10, p90, modelVersion, baseline_predicted)
    # Our fetch helpers return rich dict-like rows; the function flattens them.
    # We expose a simpler tuple here and let the implementation normalize.
    rev_rows = [
        (dt.date(2026, 5, d), 1000.0 + d, 950.0 + d, 900.0 + d, 1100.0 + d, "rev-v1", 980.0 + d)
        for d in range(1, 12)
    ]
    hr_rows = [
        (dt.date(2026, 5, d), 10.0, 9.5, 8.0, 12.0, "hr-v1", 9.0)
        for d in range(1, 12)
    ]
    item_rows = [
        (dt.date(2026, 5, d), 5.0, 4.5, 3.0, 7.0, "mi-v1", 4.0)
        for d in range(1, 12)
    ]

    conn = _mk_conn_with_rowsets([rev_rows, hr_rows, item_rows])

    upserts: list[dict] = []

    def fake_upsert(_conn, row):
        upserts.append(row)

    with patch.object(ni, "upsert_evaluation_row", side_effect=fake_upsert):
        ni.run_evaluation_pass(conn, store_id="s1", today=today)

    targets = {r["target"] for r in upserts}
    assert targets == {"REVENUE", "BUSY_HOURS", "MENU_ITEM"}
    # Each row has the expected store + non-null wape/baselineWape
    for r in upserts:
        assert r["storeId"] == "s1"
        assert r["wape"] is not None
        assert r["baselineWape"] is not None
        assert r["sampleSize"] > 0


def test_run_evaluation_pass_skips_target_with_no_reconciled_rows():
    today = dt.date(2026, 5, 12)
    # All three fetches return empty.
    conn = _mk_conn_with_rowsets([[], [], []])

    upserts: list[dict] = []

    def fake_upsert(_conn, row):
        upserts.append(row)

    with patch.object(ni, "upsert_evaluation_row", side_effect=fake_upsert):
        ni.run_evaluation_pass(conn, store_id="s1", today=today)

    assert upserts == []


def test_run_consistency_check_logs_warning_on_large_discrepancy(caplog):
    today = dt.date(2026, 5, 12)
    # Future revenue: large numbers; future items: tiny qty * tiny price => big gap.
    rev_future = [
        (dt.date(2026, 5, 13), 1000.0),
        (dt.date(2026, 5, 14), 1100.0),
    ]
    items_future = [
        (dt.date(2026, 5, 13), "item-a", 1.0, 10.0),  # 10 << 1000 => 99% discrepancy
        (dt.date(2026, 5, 14), "item-a", 1.0, 10.0),
    ]
    conn = _mk_conn_with_rowsets([rev_future, items_future])

    with caplog.at_level(logging.WARNING, logger="ml.evaluation.nightly_integration"):
        ni.run_consistency_check(conn, store_id="s1", today=today)

    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warns, "expected at least one warning for large discrepancy"
    assert any("discrepancy" in (r.message or "").lower() for r in warns)


def test_run_consistency_check_quiet_when_aligned(caplog):
    today = dt.date(2026, 5, 12)
    rev_future = [
        (dt.date(2026, 5, 13), 1000.0),
    ]
    # Item qty * price ≈ revenue => discrepancy small.
    items_future = [
        (dt.date(2026, 5, 13), "item-a", 50.0, 20.0),  # 50 * 20 = 1000
    ]
    conn = _mk_conn_with_rowsets([rev_future, items_future])

    with caplog.at_level(logging.WARNING, logger="ml.evaluation.nightly_integration"):
        ni.run_consistency_check(conn, store_id="s1", today=today)

    warns = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert warns == []
