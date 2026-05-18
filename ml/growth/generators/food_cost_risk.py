"""food_cost_risk generator — flags when 7-day projected food cost percentage
exceeds Store.targetCogsPct.
"""
from __future__ import annotations

import datetime as dt

from ml.growth.types import GrowthOpportunity, Evidence
from ml.growth.impact import food_cost_risk_impact


_HORIZON_DAYS = 7


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


def _load_forecast_food_cost_7d(conn, store_id: str) -> float | None:
    with conn.cursor() as cur:
        cur.execute(
            '''
            SELECT SUM(COALESCE(fmi."reconciledQty", fmi."predictedQty") * COALESCE(dci_recent.unit_cost, 0)) AS cost
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
            ) dci_recent ON dci_recent."itemName" = fmi."otterItemSkuId"
            ''',
            (store_id, _HORIZON_DAYS, store_id),
        )
        return _fetch_scalar(cur)


def generate(conn, *, store_id: str, as_of_date: dt.date) -> list[GrowthOpportunity]:
    target_pct = _load_target_pct(conn, store_id)
    if target_pct is None:
        return []
    revenue = _load_forecast_revenue_7d(conn, store_id)
    if not revenue or revenue <= 0:
        return []
    food_cost = _load_forecast_food_cost_7d(conn, store_id)
    if food_cost is None:
        return []
    forecast_pct = food_cost / revenue
    if forecast_pct <= target_pct:
        return []
    impact = food_cost_risk_impact(
        forecast_food_cost_pct=forecast_pct,
        target_food_cost_pct=target_pct,
        forecast_revenue=revenue,
        days=1,  # revenue already aggregated over the window; days=1 keeps the formula identity
    )
    return [GrowthOpportunity(
        store_id=store_id, as_of_date=as_of_date.isoformat(),
        opportunity_type="food_cost_risk",
        title=f"7-day food cost trending {forecast_pct*100:.1f}% (target {target_pct*100:.1f}%)",
        estimated_dollar_impact=round(impact, 2),
        confidence="medium" if forecast_pct - target_pct < 0.05 else "high",
        evidence=[
            Evidence(kind="forecast_food_cost_pct", ref="derived", value=round(forecast_pct, 4)),
            Evidence(kind="target_food_cost_pct",   ref="Store.targetCogsPct", value=round(target_pct, 4)),
            Evidence(kind="forecast_revenue_7d",    ref="ForecastDailyRevenue", value=round(revenue, 2)),
        ],
        caveats=["projection sensitive to unit-cost staleness in DailyCogsItem"],
        suggested_action=(
            "Audit top-cost ingredients for price spikes and tighten portion control. "
            "Review the menu engineering tab for high-cost low-margin items."
        ),
    )]
