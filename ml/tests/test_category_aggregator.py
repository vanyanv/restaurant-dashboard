"""Tests for the ForecastDailyCategory nightly aggregator."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

from ml.reconciliation.category_aggregator import (
    aggregate_categories_for_store,
    CategoryAggregationResult,
)


def _mk_cursor(rowsets):
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.fetchall.side_effect = rowsets
    cur.execute = MagicMock()
    return cur


def _mk_conn(cursors):
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    it = iter(cursors)
    conn.cursor.side_effect = lambda *a, **k: next(it)
    return conn


def test_aggregates_menu_items_by_category_using_avg_prices():
    """Two items in 'Sandwiches' category, one in 'Drinks':
        Sandwiches = 12*9.5 + 8*11 = 114 + 88 = 202
        Drinks     = 20*5         = 100
    Two distinct (date, category) keys -> 2 inserts.
    """
    item_rows = [
        ("Bacon Eddy", dt.date(2026, 5, 27), 12.0),
        ("Cheesy Eddy", dt.date(2026, 5, 27), 8.0),
        ("Iced Coffee", dt.date(2026, 5, 27), 20.0),
    ]
    category_rows = [
        ("Bacon Eddy", "Sandwiches"),
        ("Cheesy Eddy", "Sandwiches"),
        ("Iced Coffee", "Drinks"),
    ]
    price_rows = [
        ("Bacon Eddy", 9.5),
        ("Cheesy Eddy", 11.0),
        ("Iced Coffee", 5.0),
    ]
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()

    cursors = [
        _mk_cursor([item_rows]),
        _mk_cursor([category_rows]),
        _mk_cursor([price_rows]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)

    result = aggregate_categories_for_store(conn, store_id="store-hwd")

    assert isinstance(result, CategoryAggregationResult)
    assert result.ok
    assert result.rows_written == 2


def test_returns_ok_false_when_no_forecast_rows():
    cursors = [_mk_cursor([[]])]
    conn = _mk_conn(cursors)
    result = aggregate_categories_for_store(conn, store_id="store-hwd")
    assert not result.ok
    assert "no_forecast_rows" in result.warning


def test_falls_back_to_dollar_one_when_item_missing_from_price_map():
    """1 forecast item, no price row -> uses AVG_PRICE_FALLBACK = 1.0.
    Sandwiches = 10 * 1.0 = 10. Single row written."""
    item_rows = [("Mystery Item", dt.date(2026, 5, 27), 10.0)]
    category_rows = [("Mystery Item", "Sandwiches")]
    price_rows = []
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()
    cursors = [
        _mk_cursor([item_rows]),
        _mk_cursor([category_rows]),
        _mk_cursor([price_rows]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)

    result = aggregate_categories_for_store(conn, store_id="store-hwd")
    assert result.ok
    assert result.rows_written == 1
    # Verify the revenue param == 10.0 (fallback price applied).
    sql, params = insert_cur.execute.call_args.args
    # Params order: (id, storeId, date, categoryName, revenue)
    assert params[4] == 10.0


def test_skips_items_without_category():
    """An item with no category mapping is skipped, not assigned a default."""
    item_rows = [
        ("Bacon Eddy", dt.date(2026, 5, 27), 10.0),
        ("Orphan Item", dt.date(2026, 5, 27), 5.0),
    ]
    category_rows = [("Bacon Eddy", "Sandwiches")]  # Orphan Item not present
    price_rows = [("Bacon Eddy", 9.0), ("Orphan Item", 4.0)]
    insert_cur = MagicMock()
    insert_cur.__enter__ = lambda self: self
    insert_cur.__exit__ = lambda *a: False
    insert_cur.execute = MagicMock()
    cursors = [
        _mk_cursor([item_rows]),
        _mk_cursor([category_rows]),
        _mk_cursor([price_rows]),
        insert_cur,
    ]
    conn = _mk_conn(cursors)
    result = aggregate_categories_for_store(conn, store_id="store-hwd")
    assert result.ok
    # Only Sandwiches written; Orphan skipped.
    assert result.rows_written == 1
    sql, params = insert_cur.execute.call_args.args
    assert params[3] == "Sandwiches"
    assert params[4] == 90.0  # 10 * 9
