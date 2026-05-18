"""Tests for the MlReconciliationDaily snapshot writer."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

from ml.reconciliation.snapshot import write_reconciliation_snapshot


def test_writes_one_row_per_store_day_with_pre_post_percentiles():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    write_reconciliation_snapshot(
        conn,
        store_id="store-hwd",
        date=dt.date(2026, 5, 27),
        pre_discrepancies=[-0.6, -0.5, -0.55],
        post_discrepancies=[-0.12, -0.10, -0.14],
        method_used="mint_shrink",
    )

    sql, params = cur.execute.call_args.args
    assert "INSERT INTO \"MlReconciliationDaily\"" in sql
    assert "ON CONFLICT" in sql  # idempotent re-run

    # Spot check the percentile params.
    flat = [p for p in params if isinstance(p, (int, float))]
    rounded = [round(x, 2) for x in flat]
    # Pre median ~ 0.55 (median of |-0.6, -0.5, -0.55|), post median ~ 0.12.
    assert any(abs(v - 0.55) < 0.05 for v in rounded), rounded
    assert any(abs(v - 0.12) < 0.05 for v in rounded), rounded


def test_handles_empty_lists():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur

    write_reconciliation_snapshot(
        conn, store_id="store-hwd", date=dt.date(2026, 5, 27),
        pre_discrepancies=[], post_discrepancies=[],
        method_used="ols",
    )
    # Still writes a row, but all percentiles are NULL.
    sql, params = cur.execute.call_args.args
    assert "INSERT INTO" in sql
    nulls = [p for p in params if p is None]
    # 4 percentile params should be None.
    assert len(nulls) >= 4
