"""Tests for the GrowthOpportunity upsert writer."""
from __future__ import annotations

from unittest.mock import MagicMock

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.writer import write_opportunities


def _mk_conn_with_cursor():
    cur = MagicMock()
    cur.__enter__ = lambda self: self
    cur.__exit__ = lambda *a: False
    cur.execute = MagicMock()
    conn = MagicMock()
    conn.__enter__ = lambda self: self
    conn.__exit__ = lambda *a: False
    conn.cursor.return_value = cur
    return conn, cur


def test_writes_each_opportunity_via_upsert_keyed_on_store_date_type_title():
    conn, cur = _mk_conn_with_cursor()

    ops = [
        GrowthOpportunity(
            store_id="store-hwd",
            as_of_date="2026-06-16",
            opportunity_type="reprice",
            title="Raise price on Bacon Eddy by $0.25",
            estimated_dollar_impact=42.5,
            confidence="high",
            evidence=[Evidence(kind="elasticity_fit", ref="MenuItemElasticity:Bacon Eddy", value=-0.4)],
            caveats=[],
            suggested_action="Raise the menu price by $0.25.",
        ),
    ]
    written = write_opportunities(conn, ops)
    assert written == 1
    sql, params = cur.execute.call_args.args
    assert "INSERT INTO \"GrowthOpportunity\"" in sql
    assert "ON CONFLICT" in sql
    assert "DO UPDATE" in sql


def test_writes_zero_when_input_empty():
    conn, cur = _mk_conn_with_cursor()
    assert write_opportunities(conn, []) == 0
    cur.execute.assert_not_called()
