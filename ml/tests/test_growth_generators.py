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
    #   1. Top elastic items query (fitR2 >= 0.30, >= 60 clean days, >= 3 prices):
    #      one row: (skuId, elasticity, fitR2, sampleSize, elasticityStdErr,
    #                meanPrice, meanQty)
    elastic_rows = [
        ("Bacon Eddy", -0.4, 0.45, 60, 0.05, 9.50, 30.0),  # inelastic |e|<1
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
    # The fit reported a standard error, so the impact carries a range and the
    # ledger has a downside to rank on rather than a bare point estimate.
    assert o.impact_p10 is not None and o.impact_p90 is not None
    assert o.impact_p10 < o.estimated_dollar_impact < o.impact_p90
    assert o.impact_p10 < o.impact_p25 < o.impact_p90


def test_reprice_generator_skips_low_confidence_fits():
    from ml.growth.generators.reprice import generate

    # fitR2 < 0.30 means low-confidence — should be skipped by the SQL filter.
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
    margin $4. Lifting all the way to median would be (20-5)*4*30 = $1800 over
    30 days, but that assumes a promotion turns a slow mover into a median
    seller. The generator books 30% of that gap ($540) and records the $1800
    ceiling as evidence."""
    from ml.growth.generators.menu_engineering import generate

    # Cursor 1: per-(item, category) trailing-30d velocity + margin.
    # Columns: (itemName, category, item_velocity, item_margin, days_on_sale)
    rows = [
        ("Bacon Eddy", "Sandwiches", 5.0, 4.0, 30),
        ("Cheesy Eddy", "Sandwiches", 20.0, 4.5, 30),
        ("Veggie Eddy", "Sandwiches", 22.0, 4.2, 30),
        ("Iced Coffee", "Drinks", 50.0, 1.5, 30),
    ]
    cursors = [_mk_cursor([rows])]
    conn = _mk_conn(cursors)

    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))

    # Bacon Eddy is the only slow-mover (velocity << category median 20).
    # Cheesy Eddy ~ median; Veggie Eddy is above median (not a slow-mover).
    bacon = [o for o in out if "Bacon Eddy" in o.title]
    assert len(bacon) == 1
    # Hand-check: median of [5, 20, 22] = 20. Ceiling (20-5) * 4.0 * 30 = 1800;
    # booked at 30% = 540. Current-contribution cap is 5 * 4 * 30 = 600, so the
    # lift fraction binds here, not the cap.
    assert bacon[0].estimated_dollar_impact == 540.0
    assert bacon[0].opportunity_type == "menu_engineering"
    assert bacon[0].horizon_days == 30
    # The unbounded figure survives as evidence so the reasoning is inspectable.
    ceiling = [e for e in bacon[0].evidence if e.kind == "ceiling_if_lifted_to_median"]
    assert len(ceiling) == 1 and ceiling[0].value == 1800.0
    # Drinks category has only one item — generator should not fire (no peer).
    assert not any("Iced Coffee" in o.title for o in out)


def test_menu_engineering_impact_capped_at_the_items_own_contribution():
    """A near-dormant item has a huge gap to the median, but no promotion
    multiplies its throughput without limit. The cap keeps the claim to at most
    the item's own current contribution over the horizon."""
    from ml.growth.generators.menu_engineering import generate

    rows = [
        ("Ghost Item", "Sides", 0.1, 10.0, 30),   # gap to median is enormous
        ("Fries", "Sides", 40.0, 2.0, 30),
        ("Slaw", "Sides", 44.0, 2.0, 30),
    ]
    out = generate(_mk_conn([_mk_cursor([rows])]),
                   store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))

    ghost = [o for o in out if "Ghost Item" in o.title]
    assert len(ghost) == 1
    # 30% of the gap would be (40 - 0.1) * 10 * 30 * 0.3 = $3591 — far more than
    # the item has ever earned. Capped at 0.1 * 10 * 30 = $30.
    assert ghost[0].estimated_dollar_impact == 30.0


def test_channel_mix_generator_recommends_shifting_to_higher_net_channel():
    """Over 14 days: 300 own-channel orders at $12.50, 280 Uber delivery orders
    at a $14.00 ticket with no fee recorded. The store's Uber rate is 25%, so
    an app order leaves $10.50. Weekly app orders = 140; 10% = 14/wk; impact
    = 14 x ($12.50 - $10.50) = $28/wk."""
    from ml.growth.generators.channel_mix import generate

    # Cursor 1: (platform, mode, recorded, orders, fee, ticket)
    orders = [
        ("css-pos", "pickup", False, 300, 0.0, 300 * 12.50),
        ("ubereats", "delivery", False, 280, 0.0, 280 * 14.00),
    ]
    # Cursor 2: Store commission rates (uber, uber pickup, dd, dd pickup, gh)
    rates = [(0.25, 0.10, 0.25, 0.06, 0.25)]
    conn = _mk_conn([_mk_cursor([orders]), _mk_cursor([rates])])
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "channel_mix"
    assert o.horizon_days == 7
    assert o.title == "Shift ~14 orders/wk from 3P to 1P"
    assert o.estimated_dollar_impact == pytest.approx(28.0)
    kinds = [e.kind for e in o.evidence]
    assert "fp_net_per_order" in kinds and "tp_net_per_order" in kinds
    tp = next(e for e in o.evidence if e.kind == "tp_net_per_order")
    assert tp.value == pytest.approx(10.50)


def test_channel_mix_recorded_fee_wins_over_the_store_rate():
    from ml.growth.generators.channel_mix import generate

    orders = [
        ("css-pos", "pickup", False, 100, 0.0, 100 * 12.0),
        ("doordash", "delivery", True, 100, 100 * 3.0, 100 * 13.0),  # $3 recorded fee
    ]
    rates = [(0.27, 0.10, 0.25, 0.06, 0.25)]
    out = generate(_mk_conn([_mk_cursor([orders]), _mk_cursor([rates])]),
                   store_id="s", as_of_date=dt.date(2026, 6, 16))
    tp = next(e for e in out[0].evidence if e.kind == "tp_net_per_order")
    assert tp.value == pytest.approx(10.0)


def test_channel_mix_unknown_commission_is_not_free():
    """An app with no fee recorded and no rate on file: no card, not a $0 fee."""
    from ml.growth.generators.channel_mix import generate

    orders = [
        ("css-pos", "pickup", False, 100, 0.0, 100 * 12.0),
        ("grubhub", "delivery", False, 100, 0.0, 100 * 13.0),
    ]
    rates = [(0.27, 0.10, 0.25, 0.06, None)]
    out = generate(_mk_conn([_mk_cursor([orders]), _mk_cursor([rates])]),
                   store_id="s", as_of_date=dt.date(2026, 6, 16))
    assert out == []


def test_food_cost_risk_generator_fires_when_forecast_pct_above_target():
    """Forecast revenue $5000/day x 7 days, projected food cost 32% vs target 28%
    => (0.04) × 35000 = $1400 risk."""
    from ml.growth.generators.food_cost_risk import generate

    # Cursor 1: target_food_cost_pct (Store.targetCogsPct, stored as percent).
    target_rows = [(28.0,)]
    # Cursor 2: 7-day reconciled forecast revenue (sum).
    rev_rows = [(35000.0,)]  # $5k/day x 7
    # Cursor 3: per-item forecast qty with unit cost: (sku, qty, unit_cost).
    cost_rows = [("Burger", 2800.0, 4.0)]  # 11200 = 32% of 35000
    cursors = [_mk_cursor([target_rows]), _mk_cursor([rev_rows]), _mk_cursor([cost_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert o.opportunity_type == "food_cost_risk"
    # impact = (0.32 − 0.28) × 35000 × 1 = 1400
    assert o.estimated_dollar_impact == pytest.approx(1400.0)
    assert o.confidence == "high"  # every forecast unit costed


def test_profit_risk_generator_fires_when_projected_margin_below_threshold():
    """Forecast revenue $5000, labor $1500, food cost $1500, overhead $1000
    => profit $1000 → 20% margin. If threshold is, say, 25%, this fires."""
    from ml.growth.generators.profit_risk import generate

    # Cursor 1: 7-day reconciled forecast revenue.
    rev_rows = [(5000.0,)]
    # Cursor 2: 7-day forecast labor cost.
    labor_rows = [(1500.0,)]
    # Cursor 3: per-item forecast food cost: (sku, qty, unit_cost).
    food_rows = [("Burger", 375.0, 4.0)]  # 1500
    # Cursor 4: Store (rent, fixed labor, towels, cleaning), monthly; prorated
    # by 7/30 inside the generator.
    overhead_rows = [(1000.0 * 30.0 / 7.0, 0.0, 0.0, 0.0)]  # so prorated = 1000
    cursors = [_mk_cursor([rev_rows]), _mk_cursor([labor_rows]), _mk_cursor([food_rows]), _mk_cursor([overhead_rows])]
    conn = _mk_conn(cursors)
    out = generate(conn, store_id="store-hwd", as_of_date=dt.date(2026, 6, 16))
    # Should fire because 20% margin < threshold. The exact threshold is a
    # generator constant; the test just asserts the opportunity surfaces.
    assert len(out) >= 1
    o = out[0]
    assert o.opportunity_type == "profit_risk"
    assert "at most" not in o.title  # every input on file


def test_generator_registry_lists_exactly_five_after_w10():
    from ml.growth.generators import REGISTRY
    types = sorted(t for t, _ in REGISTRY)
    assert types == sorted([
        "reprice", "menu_engineering", "channel_mix",
        "food_cost_risk", "profit_risk",
    ])


def test_food_cost_risk_does_not_cost_an_unmatched_item_at_zero():
    """An item with no cost on file is left out and named; the % is a floor."""
    from ml.growth.generators.food_cost_risk import generate

    cost_rows = [("Burger", 2800.0, 4.0), ("New Wrap", 700.0, None)]
    conn = _mk_conn([_mk_cursor([[(28.0,)]]), _mk_cursor([[(35000.0,)]]), _mk_cursor([cost_rows])])
    out = generate(conn, store_id="s", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert "at least" in o.title
    assert any("New Wrap" in c for c in o.caveats)
    assert o.confidence == "medium"  # 80% of units costed


def test_food_cost_risk_under_target_with_gaps_says_nothing():
    from ml.growth.generators.food_cost_risk import generate

    cost_rows = [("Burger", 1000.0, 4.0), ("New Wrap", 5000.0, None)]
    conn = _mk_conn([_mk_cursor([[(28.0,)]]), _mk_cursor([[(35000.0,)]]), _mk_cursor([cost_rows])])
    assert generate(conn, store_id="s", as_of_date=dt.date(2026, 6, 16)) == []


def test_profit_risk_missing_costs_are_named_not_zero():
    """No labor and no rent on file: margin is an upper bound and says so."""
    from ml.growth.generators.profit_risk import generate

    cursors = [
        _mk_cursor([[(5000.0,)]]),                  # revenue
        _mk_cursor([[(None,)]]),                    # labor: no Harri rows
        _mk_cursor([[("Burger", 1200.0, 4.0)]]),    # food 4800 -> margin 4%
        _mk_cursor([[(None, None, None, None)]]),   # nothing entered
    ]
    out = generate(_mk_conn(cursors), store_id="s", as_of_date=dt.date(2026, 6, 16))
    assert len(out) == 1
    o = out[0]
    assert "at most" in o.title
    assert o.confidence == "low"
    assert any("labor" in c and "rent" in c for c in o.caveats)
    assert "forecast_labor" not in [e.kind for e in o.evidence]


def test_profit_risk_healthy_with_gaps_is_not_emitted():
    from ml.growth.generators.profit_risk import generate

    cursors = [
        _mk_cursor([[(5000.0,)]]),
        _mk_cursor([[(None,)]]),
        _mk_cursor([[("Burger", 100.0, 4.0)]]),
        _mk_cursor([[(None, None, None, None)]]),
    ]
    assert generate(_mk_conn(cursors), store_id="s", as_of_date=dt.date(2026, 6, 16)) == []


def test_menu_engineering_does_not_call_a_new_item_slow():
    """Nine days on sale: velocity is per day on sale, and it is too new to judge."""
    from ml.growth.generators.menu_engineering import generate

    rows = [
        ("New Dish", "Mains", 1.3, 5.0, 9),
        ("Old A", "Mains", 20.0, 5.0, 30),
        ("Old B", "Mains", 22.0, 5.0, 30),
    ]
    out = generate(_mk_conn([_mk_cursor([rows])]), store_id="s", as_of_date=dt.date(2026, 6, 16))
    assert not any("New Dish" in o.title for o in out)


def test_reprice_never_recommends_a_cut():
    """An elastic fit once produced "cut the slider by $0.25"."""
    from ml.growth.generators.reprice import generate

    elastic_rows = [("Signature Slider", -2.4, 0.45, 90, 0.2, 13.49, 40.0)]
    conn = _mk_conn([_mk_cursor([elastic_rows]), _mk_cursor([[("Signature Slider", 6.0)]])])
    assert generate(conn, store_id="s", as_of_date=dt.date(2026, 6, 16)) == []


def test_reprice_rejects_thin_or_weak_fits():
    from ml.growth.generators.reprice import generate

    rows = [
        ("Weak", -0.4, 0.15, 90, 0.05, 9.5, 30.0),   # R2 below 0.30
        ("Thin", -0.4, 0.45, 30, 0.05, 9.5, 30.0),   # 30 days
        ("NoSE", -0.4, 0.45, 90, None, 9.5, 30.0),   # no standard error
    ]
    margins = [("Weak", 4.0), ("Thin", 4.0), ("NoSE", 4.0)]
    conn = _mk_conn([_mk_cursor([rows]), _mk_cursor([margins])])
    assert generate(conn, store_id="s", as_of_date=dt.date(2026, 6, 16)) == []
