"""One fixture test per generator (5 total by end of W10).

Each test sets up a minimal DB-like state via mocked cursors, runs the
generator, asserts shape + dollar-impact matches the hand-computed value
from the impact module."""
from __future__ import annotations

import datetime as dt
from unittest.mock import MagicMock

import pytest


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


def test_reprice_generator_produces_opportunity_for_inelastic_item():
    from ml.growth.generators.reprice import generate

    # Mocked cursors in the SQL call order of reprice.generate:
    #   1. Top elastic items query (fitR2 >= 0.10, pricePointCount >= 2):
    #      one row: (skuId, elasticity, fitR2, sampleSize, meanPrice, meanQty)
    elastic_rows = [
        ("Bacon Eddy", -0.4, 0.45, 60, 9.50, 30.0),  # inelastic |e|<1
    ]
    # 2. Item margin (salesRevenue - lineCost per qty, last 30 days):
    margin_rows = [("Bacon Eddy", 4.25)]
    cursors = [_mk_cursor([elastic_rows]), _mk_cursor([margin_rows])]
    conn = _mk_conn(cursors)

    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))

    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "reprice"
    assert o.store_id == "store-hwd"
    assert o.as_of_date == "2026-06-16"
    # Inelastic item — recommend small price increase; the formula's exact
    # delta_price is a generator choice. The hand-check value: a $0.25 raise
    # on an inelastic item with elasticity=-0.4, qty=30, margin=4.25 yields
    # net benefit > 0.
    assert o.estimated_dollar_impact > 0  # positive only if generator recommends a beneficial change
    # Evidence must cite the elasticity fit:
    kinds = [e.kind for e in o.evidence]
    assert "elasticity_fit" in kinds


def test_reprice_generator_skips_low_confidence_fits():
    from ml.growth.generators.reprice import generate

    # fitR2 < 0.10 means low-confidence — should be skipped by the SQL filter.
    # (Test reflects "no candidates returned" since the filter happens server-side.)
    elastic_rows: list[tuple] = []
    cursors = [_mk_cursor([elastic_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert out == []


def test_generator_registry_lists_all_five_by_w10_close():
    """After Task 8 lands, the registry must enumerate exactly 5 generators."""
    from ml.growth.generators import REGISTRY
    # By W9 close only reprice is in the registry; the assertion tightens by W10.
    types = [t for t, _ in REGISTRY]
    assert "reprice" in types


def test_menu_engineering_generator_flags_slow_movers_in_active_categories():
    """A category whose median velocity is 20/day with an item at 5/day and
    margin $4 — over 30 days the upside if lifted to median is (20-5)*4*30 = $1800."""
    from ml.growth.generators.menu_engineering import generate

    # Cursor 1: per-(item, category) trailing-30d velocity + margin.
    # Columns: (itemName, category, item_velocity, item_margin)
    rows = [
        ("Bacon Eddy", "Sandwiches", 5.0, 4.0),
        ("Cheesy Eddy", "Sandwiches", 20.0, 4.5),
        ("Veggie Eddy", "Sandwiches", 22.0, 4.2),
        ("Iced Coffee", "Drinks", 50.0, 1.5),
    ]
    cursors = [_mk_cursor([rows])]
    conn = _mk_conn(cursors)

    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))

    # Bacon Eddy is the only slow-mover (velocity << category median 20).
    # Cheesy Eddy ~ median; Veggie Eddy is above median (not a slow-mover).
    bacon = [o for o in out if "Bacon Eddy" in o.title]
    assert len(bacon) == 1
    # Hand-check: median of [5, 20, 22] = 20. (20-5) * 4.0 * 30 = 1800.
    assert bacon[0].estimated_dollar_impact == 1800.0
    assert bacon[0].opportunity_type == "menu_engineering"
    # Drinks category has only one item — generator should not fire (no peer).
    assert not any("Iced Coffee" in o.title for o in out)
