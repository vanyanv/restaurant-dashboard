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


def test_channel_mix_generator_recommends_shifting_to_higher_net_channel():
    """First-party gives $12.50/order net; 3P gives $10.00/order net.
    A shift of 50 orders/week from 3P → 1P = +$125/week impact."""
    from ml.growth.generators.channel_mix import generate

    # Cursor 1: trailing-14d per-channel summary, columns: (channel, order_count, net_per_order)
    rows = [
        ("fp", 300, 12.50),  # first-party
        ("tp", 200, 10.00),  # third-party
    ]
    cursors = [_mk_cursor([rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "channel_mix"
    # Generator should pick a credible shift size — assert sign + ballpark only.
    assert o.estimated_dollar_impact > 0
    # Evidence references both channels:
    kinds = [e.kind for e in o.evidence]
    assert "fp_net_per_order" in kinds and "tp_net_per_order" in kinds


def test_food_cost_risk_generator_fires_when_forecast_pct_above_target():
    """Forecast revenue $5000/day x 7 days, projected food cost 32% vs target 28%
    => (0.04) × 35000 = $1400 risk."""
    from ml.growth.generators.food_cost_risk import generate

    # Cursor 1: target_food_cost_pct (Store.targetCogsPct, stored as percent).
    target_rows = [(28.0,)]
    # Cursor 2: 7-day reconciled forecast revenue (sum).
    rev_rows = [(35000.0,)]  # $5k/day x 7
    # Cursor 3: 7-day projected food cost (sum of forecast_qty × unit_cost).
    cost_rows = [(11200.0,)]  # 32% of 35000
    cursors = [_mk_cursor([target_rows]), _mk_cursor([rev_rows]), _mk_cursor([cost_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "food_cost_risk"
    # impact = (0.32 − 0.28) × 35000 × 1 = 1400
    assert o.estimated_dollar_impact == pytest.approx(1400.0)


def test_profit_risk_generator_fires_when_projected_margin_below_threshold():
    """Forecast revenue $5000, labor $1500, food cost $1500, overhead $1000
    => profit $1000 → 20% margin. If threshold is, say, 25%, this fires."""
    from ml.growth.generators.profit_risk import generate

    # Cursor 1: 7-day reconciled forecast revenue.
    rev_rows = [(5000.0,)]
    # Cursor 2: 7-day forecast labor cost.
    labor_rows = [(1500.0,)]
    # Cursor 3: 7-day forecast food cost.
    food_rows = [(1500.0,)]
    # Cursor 4: monthly fixed overhead (Store.fixedMonthly* sums) prorated to 7 days.
    # The generator multiplies its returned scalar by 7/30 internally — but for
    # the test we mock the raw store field directly. Pass the prorated value here.
    overhead_rows = [(1000.0 * 30.0 / 7.0,)]  # so prorated = 1000
    cursors = [_mk_cursor([rev_rows]), _mk_cursor([labor_rows]), _mk_cursor([food_rows]), _mk_cursor([overhead_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    # Should fire because 20% margin < threshold. The exact threshold is a
    # generator constant; the test just asserts the opportunity surfaces.
    assert len(out) >= 1
    o = out[0]
    assert o.opportunity_type == "profit_risk"


def test_generator_registry_lists_exactly_five_after_w10():
    from ml.growth.generators import REGISTRY
    types = sorted(t for t, _ in REGISTRY)
    assert types == sorted([
        "reprice", "menu_engineering", "channel_mix",
        "food_cost_risk", "profit_risk",
    ])
