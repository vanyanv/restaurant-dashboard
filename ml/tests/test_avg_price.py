"""Tests for the avg_price helper used by the W6-8 reconciliation pipeline.

A second implementation of the same formula lives as a SQL subquery inside
ml.evaluation.nightly_integration._fetch_future_items_with_price (because
that function joins predicted items with their avg price in one round-trip).
Both implementations follow the same rule and are documented to stay in
sync; this module's tests pin the formula contract.
"""
from __future__ import annotations

from unittest.mock import MagicMock

from ml.reconciliation.avg_price import (
    compute_item_avg_prices,
    AVG_PRICE_FALLBACK,
)


def _mk_conn_with_rows(rows):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.return_value = rows
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn


def test_compute_item_avg_prices_returns_dict_keyed_by_item_name():
    rows = [("Bacon Eddy", 9.5), ("Cheesy Eddy", 11.25)]
    conn = _mk_conn_with_rows(rows)
    prices = compute_item_avg_prices(conn, store_id="store-hwd", lookback_days=60)
    assert prices == {"Bacon Eddy": 9.5, "Cheesy Eddy": 11.25}


def test_compute_item_avg_prices_skips_none_prices():
    rows = [("Bacon Eddy", 9.5), ("Free Sample", None)]
    conn = _mk_conn_with_rows(rows)
    prices = compute_item_avg_prices(conn, store_id="store-hwd", lookback_days=60)
    assert "Free Sample" not in prices
    assert prices["Bacon Eddy"] == 9.5


def test_avg_price_fallback_constant_is_one():
    # Spec §2 + matches the existing consistency.py fallback.
    assert AVG_PRICE_FALLBACK == 1.0


def test_compute_item_avg_prices_executes_lookback_query():
    conn = _mk_conn_with_rows([])
    compute_item_avg_prices(conn, store_id="store-hwd", lookback_days=60)
    cur = conn.cursor.return_value
    sql, params = cur.execute.call_args.args
    assert "OtterMenuItem" in sql
    assert params == ("store-hwd", 60)
