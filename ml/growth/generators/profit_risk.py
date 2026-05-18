"""profit_risk generator — fires when projected 7-day net profit margin
falls below threshold. Reuses the forecast revenue / food cost queries from
food_cost_risk for consistency; labor from HarriDailyLabor, overhead from
Store.fixedMonthly* fields.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import profit_risk_impact


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
    return val if val is not None else 0.0


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
        return 0.0
    return val * _HORIZON_DAYS


def _load_forecast_food_cost(conn, store_id):
    """Same shape as food_cost_risk._load_forecast_food_cost_7d — duplicated
    inline to keep generator modules self-contained (DRY pressure: low; if
    a third caller appears, extract to ml/growth/shared.py)."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE(fmi."reconciledQty", fmi."predictedQty") * COALESCE(dci.unit_cost, 0))
            FROM (
              SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
                     "otterItemSkuId", "forecastDate",
                     "reconciledQty", "predictedQty"
              FROM "ForecastMenuItem"
              WHERE "storeId" = %s AND "forecastSource" = 'native'
                AND "forecastDate" >= CURRENT_DATE
                AND "forecastDate" <  CURRENT_DATE + %s
              ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
            ) fmi
            LEFT JOIN (
              SELECT DISTINCT ON ("itemName") "itemName", "unitCost" AS unit_cost
              FROM "DailyCogsItem"
              WHERE "storeId" = %s AND "unitCost" IS NOT NULL
              ORDER BY "itemName", date DESC
            ) dci ON dci."itemName" = fmi."otterItemSkuId"
            ''',
            (store_id, _HORIZON_DAYS, store_id),
        )
        val = _fetch_scalar(cur)
    return val if val is not None else 0.0


def _load_overhead_7d(conn, store_id):
    """7/30 of the monthly fixed-overhead inputs on Store."""
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT COALESCE("fixedMonthlyLabor", 0)
                 + COALESCE("fixedMonthlyRent", 0)
                 + COALESCE("fixedMonthlyTowels", 0)
                 + COALESCE("fixedMonthlyCleaning", 0) AS monthly
            FROM "Store" WHERE id = %s
            ''',
            (store_id,),
        )
        val = _fetch_scalar(cur)
    monthly = val if val is not None else 0.0
    return monthly * (_HORIZON_DAYS / 30.0)  # spec §3.2 proration


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    revenue = _load_forecast_revenue(conn, store_id)
    if revenue <= 0:
        return []
    labor = _load_forecast_labor(conn, store_id)
    food_cost = _load_forecast_food_cost(conn, store_id)
    overhead = _load_overhead_7d(conn, store_id)

    profit = profit_risk_impact(
        forecast_revenue=revenue, forecast_labor=labor,
        forecast_food_cost=food_cost, fixed_overhead=overhead,
    )
    margin = profit / revenue if revenue else 0.0
    if margin >= _MARGIN_FLAG_THRESHOLD:
        return []  # healthy — no warning needed

    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="profit_risk",
        title=f"7-day projected margin {margin*100:.1f}% (forecast)",
        estimated_dollar_impact=round(profit, 2),  # signed — negative = loss
        confidence="medium",
        evidence=[
            Evidence(kind="forecast_revenue",  ref="ForecastDailyRevenue",  value=round(revenue, 2)),
            Evidence(kind="forecast_labor",    ref="HarriDailyLabor",        value=round(labor, 2)),
            Evidence(kind="forecast_food_cost",ref="DailyCogsItem×Forecast", value=round(food_cost, 2)),
            Evidence(kind="fixed_overhead_7d", ref="Store.fixedMonthly*",    value=round(overhead, 2)),
        ],
        caveats=[
            "labor projected as 30d trailing average; weekly variance not captured",
            "overhead prorated linearly from monthly inputs",
        ],
        suggested_action=(
            "Cross-check the labor schedule for the coming week and the menu "
            "engineering tab for high-cost movers. Tighten the staffing forecast "
            "if hourly orders projection is below your trigger."
        ),
    )]
