"""food_cost_risk generator — flags when 7-day projected food cost percentage
exceeds Store.targetCogsPct.

Forecast items with no unit cost on file are NOT costed at $0. They are left
out and named, which makes the projected percentage a floor: if it is over
target with some items uncosted, the real figure is further over. If it is
under target with items uncosted, nothing can be said, and nothing is emitted.
Confidence is the share of forecast units that could be costed, not the size
of the gap.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import food_cost_risk_impact
from ml.growth.shared import load_forecast_food_cost


_HORIZON_DAYS = 7
#: Share of forecast units with a cost on file for "high" / "medium" confidence.
_HIGH_COVERAGE = 0.95
_MEDIUM_COVERAGE = 0.80


def _fetch_scalar(cur) -> float | None:
    rows = cur.fetchall()
    if not rows or rows[0][0] is None:
        return None
    return float(rows[0][0])


def _load_target_pct(conn, store_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute('SELECT "targetCogsPct" FROM "Store" WHERE id = %s', (store_id,))
        val = _fetch_scalar(cur)
    return val / 100.0 if val is not None else None  # stored as percent


def _load_forecast_revenue_7d(conn, store_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE("reconciledRevenue", "predictedRevenue")) AS rev
            FROM (
              SELECT DISTINCT ON ("forecastDate") "forecastDate",
                     "reconciledRevenue", "predictedRevenue"
              FROM "ForecastDailyRevenue"
              WHERE "storeId" = %s AND "hourBucket" = 0
                AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "forecastDate", "generatedAt" DESC
            ) f
            ''',
            (store_id, _HORIZON_DAYS),
        )
        return _fetch_scalar(cur)


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    target_pct = _load_target_pct(conn, store_id)
    if target_pct is None:
        return []
    revenue = _load_forecast_revenue_7d(conn, store_id)
    if not revenue or revenue <= 0:
        return []
    cost = load_forecast_food_cost(conn, store_id, _HORIZON_DAYS)
    if cost is None or cost.matched_qty <= 0:
        return []
    forecast_pct = cost.matched_cost / revenue
    if forecast_pct <= target_pct:
        return []  # under target — or, with items uncosted, not knowable
    impact = food_cost_risk_impact(
        forecast_food_cost_pct=forecast_pct,
        target_food_cost_pct=target_pct,
        forecast_revenue=revenue,
        days=1,  # revenue already aggregated over the window; days=1 keeps the formula identity
    )
    coverage = cost.coverage or 0.0
    confidence = (
        "high" if coverage >= _HIGH_COVERAGE
        else "medium" if coverage >= _MEDIUM_COVERAGE
        else "low"
    )
    floor = "" if cost.is_complete else "at least "
    caveats = ["projection sensitive to unit-cost staleness in DailyCogsItem"]
    if not cost.is_complete:
        caveats.insert(0, (
            f"{len(cost.unmatched)} forecast item(s) have no cost on file and are left "
            f"out ({cost.unmatched_names()}), so the real food cost is higher than shown"
        ))
    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="food_cost_risk",
        title=f"7-day food cost trending {floor}{forecast_pct*100:.1f}% (target {target_pct*100:.1f}%)",
        estimated_dollar_impact=round(impact, 2),
        horizon_days=_HORIZON_DAYS,
        confidence=confidence,
        evidence=[
            Evidence(kind="forecast_food_cost_pct", ref="derived", value=round(forecast_pct, 4)),
            Evidence(kind="target_food_cost_pct",   ref="Store.targetCogsPct", value=round(target_pct, 4)),
            Evidence(kind="forecast_revenue_7d",    ref="ForecastDailyRevenue", value=round(revenue, 2)),
            Evidence(kind="costed_unit_share",      ref="ForecastMenuItem×DailyCogsItem", value=round(coverage, 3)),
            Evidence(kind="uncosted_items",         ref="ForecastMenuItem×DailyCogsItem", value=len(cost.unmatched)),
        ],
        caveats=caveats,
        suggested_action=(
            "Audit top-cost ingredients for price spikes and tighten portion control. "
            "Review the menu engineering tab for high-cost low-margin items."
        ),
    )]
