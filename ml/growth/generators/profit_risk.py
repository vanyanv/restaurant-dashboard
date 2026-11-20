"""profit_risk generator — fires when projected 7-day net profit margin
falls below threshold. Reuses the forecast revenue / food cost queries from
food_cost_risk for consistency; labor from HarriDailyLabor, overhead from
Store.fixedMonthly* fields.

A cost that is not on file is MISSING, not $0. Every missing cost makes the
projected profit look better than it is, so a projection with gaps is an
upper bound on margin: if it is under the threshold anyway, the risk is real
(and the missing inputs are named on the card); if it is over, nothing can be
said and nothing is emitted. Labor with no Harri rows, rent not entered, and
forecast items with no unit cost are the gaps tracked here. Towels, cleaning
and fixed labor are optional lines a store may genuinely not have; when they
are not entered they are named too, but do not by themselves block a card.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import profit_risk_impact
from ml.growth.shared import load_forecast_food_cost


_HORIZON_DAYS = 7
_MARGIN_FLAG_THRESHOLD = 0.10  # spec §3.2: flag when projected margin < 10%


def _fetch_scalar(cur) -> float | None:
    rows = cur.fetchall()
    if not rows or rows[0][0] is None:
        return None
    return float(rows[0][0])


def _load_forecast_revenue(conn, store_id):
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE("reconciledRevenue", "predictedRevenue"))
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
        val = _fetch_scalar(cur)
    return val


def _load_forecast_labor(conn, store_id):
    """Trailing-30d daily-labor average × 7 days, as the simplest baseline.
    Prefer forecastCost when present, else actualCost."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT AVG(COALESCE("forecastCost", "actualCost"))
            FROM "HarriDailyLabor"
            WHERE "storeId" = %s AND date >= CURRENT_DATE - 30
            ''',
            (store_id,),
        )
        val = _fetch_scalar(cur)
    if val is None:
        return None  # no labor on file: missing, not free
    return val * _HORIZON_DAYS


def _load_overhead_7d(conn, store_id):
    """7/30 of the monthly fixed-overhead inputs on Store, with the ones not
    entered named. Returns (dollars over 7 days, [missing required], [not entered])."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT "fixedMonthlyRent", "fixedMonthlyLabor",
                   "fixedMonthlyTowels", "fixedMonthlyCleaning"
            FROM "Store" WHERE id = %s
            ''',
            (store_id,),
        )
        rows = cur.fetchall()
    if not rows:
        return 0.0, ["rent"], []
    rent, fixed_labor, towels, cleaning = rows[0]
    missing = [] if rent is not None else ["rent"]
    not_entered = [
        name for name, v in (("fixed labor", fixed_labor), ("towels", towels), ("cleaning", cleaning))
        if v is None
    ]
    monthly = sum(float(v) for v in (rent, fixed_labor, towels, cleaning) if v is not None)
    return monthly * (_HORIZON_DAYS / 30.0), missing, not_entered  # spec §3.2 proration


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    revenue = _load_forecast_revenue(conn, store_id)
    if revenue is None or revenue <= 0:
        return []
    labor = _load_forecast_labor(conn, store_id)
    food = load_forecast_food_cost(conn, store_id, _HORIZON_DAYS)
    overhead, missing, not_entered = _load_overhead_7d(conn, store_id)

    if labor is None:
        missing.append("labor (no Harri hours in the last 30 days)")
    if food is None:
        missing.append("food cost (no item forecast)")
    elif not food.is_complete:
        missing.append(
            f"food cost for {len(food.unmatched)} forecast item(s) with no cost on file "
            f"({food.unmatched_names()})"
        )
    food_cost = food.matched_cost if food is not None else 0.0

    profit = profit_risk_impact(
        forecast_revenue=revenue, forecast_labor=labor or 0.0,
        forecast_food_cost=food_cost, fixed_overhead=overhead,
    )
    margin = profit / revenue
    if margin >= _MARGIN_FLAG_THRESHOLD:
        # Healthy — or, with costs missing, not knowable. Either way no card:
        # a margin computed with costs left out is only an upper bound.
        return []

    caveats = [
        "labor projected as 30d trailing average; weekly variance not captured",
        "overhead prorated linearly from monthly inputs",
    ]
    if missing or not_entered:
        gaps = missing + [f"{n} (not entered)" for n in not_entered]
        caveats.insert(0, (
            "left out because not on file: " + "; ".join(gaps)
            + " — the real margin is lower than shown"
        ))
    bound = "at most " if (missing or not_entered) else ""

    evidence = [
        Evidence(kind="forecast_revenue",  ref="ForecastDailyRevenue",  value=round(revenue, 2)),
        Evidence(kind="fixed_overhead_7d", ref="Store.fixedMonthly*",    value=round(overhead, 2)),
    ]
    if labor is not None:
        evidence.append(Evidence(kind="forecast_labor", ref="HarriDailyLabor", value=round(labor, 2)))
    if food is not None:
        evidence.append(Evidence(kind="forecast_food_cost", ref="DailyCogsItem×Forecast", value=round(food_cost, 2)))
    if missing:
        evidence.append(Evidence(kind="missing_inputs", ref="derived", value="; ".join(missing)))

    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="profit_risk",
        title=f"7-day projected margin {bound}{margin*100:.1f}% (forecast)",
        estimated_dollar_impact=round(profit, 2),  # signed — negative = loss
        horizon_days=_HORIZON_DAYS,
        # Every input complete: medium (it is still a forecast). Gaps: low.
        confidence="low" if missing else "medium",
        evidence=evidence,
        caveats=caveats,
        suggested_action=(
            "Cross-check the labor schedule for the coming week and the menu "
            "engineering tab for high-cost movers. Tighten the staffing forecast "
            "if hourly orders projection is below your trigger."
        ),
    )]
