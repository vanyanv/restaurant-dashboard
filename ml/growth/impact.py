"""Pure dollar-impact formulas. Spec §3.2 — no tunable multipliers.

Every input is sourced from a real column in the schema:
  * elasticity, current_units, current_margin, delta_price -> MenuItemElasticity / OtterMenuItem / Recipe
  * category_median_velocity, item_velocity              -> OtterMenuItem 30-day aggregate
  * item_margin                                          -> DailyCogsItem (salesRevenue - lineCost) per qty
  * units_shifted, high/low_channel_net_per_order        -> OtterDailySummary fp/tp net
  * forecast_food_cost_pct, target_food_cost_pct         -> Store.targetCogsPct / reconciled forecasts
  * forecast_revenue                                     -> ForecastDailyRevenue.reconciledRevenue
  * forecast_labor, fixed_overhead                       -> HarriDailyLabor / Store.fixedMonthly*
"""
from __future__ import annotations


def reprice_impact(
    *, elasticity: float, current_units: float,
    current_margin: float, delta_price: float,
) -> float:
    """Per spec §3.2: elasticity × units × margin × ΔPrice.

    Sign convention: positive impact = beneficial for the operator.
    Elasticity is typically negative (price up → units down). The product's
    sign captures the joint direction of intent (e.g. raise price on inelastic
    item → small unit loss × big margin gain = positive net)."""
    return elasticity * current_units * current_margin * delta_price


def menu_engineering_impact(
    *, category_median_velocity: float, item_velocity: float,
    item_margin: float, days: int,
) -> float:
    """Spec §3.2: (category_median_velocity − item_velocity) × item_margin × days.

    `days` is supplied by the caller — typically 30 for spec §3.2 (matching
    the 30-day aggregate window the inputs come from). No magic constant
    inside the formula."""
    return (category_median_velocity - item_velocity) * item_margin * days


def channel_mix_impact(
    *, units_shifted: float,
    high_channel_net_per_order: float, low_channel_net_per_order: float,
) -> float:
    """Spec §3.2: units_shifted × (high_channel_net − low_channel_net)."""
    return units_shifted * (high_channel_net_per_order - low_channel_net_per_order)


def food_cost_risk_impact(
    *, forecast_food_cost_pct: float, target_food_cost_pct: float,
    forecast_revenue: float, days: int,
) -> float:
    """Spec §3.2: (forecast_pct − target_pct) × forecast_revenue × days."""
    return (forecast_food_cost_pct - target_food_cost_pct) * forecast_revenue * days


def profit_risk_impact(
    *, forecast_revenue: float, forecast_labor: float,
    forecast_food_cost: float, fixed_overhead: float,
) -> float:
    """Spec §3.2: forecast_revenue − (labor + food_cost + overhead).

    Caller flags this as `profit_risk` opportunity only when the result is
    below a threshold (e.g. negative) — the threshold is a generator-level
    decision, not a tunable in this pure formula."""
    return forecast_revenue - (forecast_labor + forecast_food_cost + fixed_overhead)
