"""Typed shapes for growth opportunities.

Mirrors src/types/growth.ts — keep them in lockstep. The Python side
is the source of truth (generators produce these; writer persists them);
the TS side is read-only (server action returns rows as this shape).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional, Literal, Union


OpportunityType = Literal[
    "reprice",
    "menu_engineering",
    "channel_mix",
    "food_cost_risk",
    "profit_risk",
]

Confidence = Literal["low", "medium", "high"]


@dataclass
class Evidence:
    kind: str          # e.g. "elasticity_fit", "forecast_revenue", "labor_cost"
    ref: str           # e.g. "MenuItemElasticity.fitR2", "ForecastDailyRevenue:2026-06-20"
    value: Union[float, int, str]


@dataclass
class GrowthOpportunity:
    store_id: str
    as_of_date: str                  # YYYY-MM-DD
    opportunity_type: OpportunityType
    title: str
    estimated_dollar_impact: float
    # Number of days `estimated_dollar_impact` covers. Generators disagree (7
    # for the risk types, 30 for menu engineering) and the UI used to label
    # every one of them "/wk", overstating the 30-day ones by ~4x.
    horizon_days: int
    confidence: Confidence
    evidence: list[Evidence] = field(default_factory=list)
    caveats: list[str] = field(default_factory=list)
    suggested_action: str = ""
    # 10th / 25th / 90th percentile of the impact once the elasticity's standard
    # error is propagated. None when the fit reported no standard error — an
    # invented range reads as precision the estimate does not have. impact_p25
    # is what the Decisions ledger ranks on.
    impact_p10: Optional[float] = None
    impact_p25: Optional[float] = None
    impact_p90: Optional[float] = None


# Deferred for Phase 2 (kept here as a comment so the union stays explicit):
#   "launch_analogue", "lost_sales", "weak_promo"
DEFERRED_TYPES: tuple[str, ...] = ("launch_analogue", "lost_sales", "weak_promo")
