"""Tests for ml/growth/impact.py.

Spec §3.2 locks the 5 formulas; these tests pin each one to a hand-computed
value. The 'no tunable multipliers' rule is enforced structurally: any
constant in impact.py that's not derived from a column must be explained in
a comment, AND there's an explicit grep test below.
"""
from __future__ import annotations

import pytest

from ml.growth.impact import (
    reprice_impact,
    menu_engineering_impact,
    channel_mix_impact,
    food_cost_risk_impact,
    profit_risk_impact,
)


def test_reprice_impact_closed_form():
    # elasticity = -1.5, current_units = 100, current_margin = $3.00, dPrice = +$0.50
    # impact = elasticity × current_units × current_margin × dPrice
    #        = -1.5 × 100 × 3.00 × 0.50 = -225 (loss because demand falls)
    # Sign convention: positive impact = beneficial; negative = harmful.
    # Per spec the formula is signed by elasticity × dPrice intent.
    impact = reprice_impact(
        elasticity=-1.5, current_units=100, current_margin=3.00, delta_price=0.50,
    )
    assert impact == pytest.approx(-225.0)


def test_menu_engineering_impact_closed_form():
    # category_median_velocity = 20 units/day, item_velocity = 10 units/day
    # item_margin = $4.00, days = 30
    # impact = (20 − 10) × 4.00 × 30 = $1200 (upside if we lift to median)
    impact = menu_engineering_impact(
        category_median_velocity=20, item_velocity=10,
        item_margin=4.00, days=30,
    )
    assert impact == pytest.approx(1200.0)


def test_channel_mix_impact_closed_form():
    # units_shifted = 50, high_channel_net = $12.50, low_channel_net = $10.00
    impact = channel_mix_impact(
        units_shifted=50, high_channel_net_per_order=12.50, low_channel_net_per_order=10.00,
    )
    assert impact == pytest.approx(125.0)


def test_food_cost_risk_impact_closed_form():
    # forecast_food_cost_pct = 0.32, target_food_cost_pct = 0.28
    # forecast_revenue = $5000/day, days = 7
    # impact = (0.32 − 0.28) × 5000 × 7 = $1400 risk
    impact = food_cost_risk_impact(
        forecast_food_cost_pct=0.32, target_food_cost_pct=0.28,
        forecast_revenue=5000.0, days=7,
    )
    assert impact == pytest.approx(1400.0)


def test_profit_risk_impact_closed_form():
    # forecast_revenue = $5000, forecast_labor = $1500,
    # forecast_food_cost = $1500, fixed_overhead = $1000
    # impact = 5000 − (1500 + 1500 + 1000) = $1000 profit
    impact = profit_risk_impact(
        forecast_revenue=5000.0, forecast_labor=1500.0,
        forecast_food_cost=1500.0, fixed_overhead=1000.0,
    )
    assert impact == pytest.approx(1000.0)


def test_no_tunable_multipliers_constants_in_impact_module():
    """Spec §3.2: no tunable multipliers. Any numeric constant in impact.py
    must be a structural constant (e.g. 0.0 boundary checks) — not a tunable
    coefficient. Static grep: only allow {0, 1, 100, -1.0}-style fixed values."""
    import ast
    import pathlib
    src = pathlib.Path("ml/growth/impact.py").read_text()
    tree = ast.parse(src)
    allowed = {0, 0.0, 1, 1.0, -1, -1.0, 100, 100.0}  # boundaries / unit conversions
    bad: list[tuple[int, float]] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            if node.value not in allowed:
                # Allow positional 30 (days-in-month) ONLY if accompanied by a
                # comment containing "spec §3.2" on the same line.
                line = src.splitlines()[node.lineno - 1]
                if "spec §3.2" not in line.lower():
                    bad.append((node.lineno, node.value))
    assert not bad, (
        f"Tunable-looking constants found in impact.py: {bad}. "
        "Either derive from a column or annotate with 'spec §3.2' to permit."
    )
