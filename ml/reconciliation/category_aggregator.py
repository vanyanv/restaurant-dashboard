"""Nightly aggregation of ForecastMenuItem rows into ForecastDailyCategory.

Pipeline:
  1. Pull latest native ForecastMenuItem rows for the next horizon.
  2. Join each item to its category via OtterMenuItem (most recent category
     observation per item).
  3. Multiply qty by avg price (from ml.reconciliation.avg_price), falling
     back to $1 for items with no observed price history.
  4. Sum into (storeId, date, categoryName) and upsert into
     ForecastDailyCategory.

Idempotent: ON CONFLICT upsert keyed on (storeId, date, categoryName).
"""
from __future__ import annotations

from dataclasses import dataclass

from ml.db import cuid_like
from ml.reconciliation.avg_price import (
    compute_item_avg_prices,
    AVG_PRICE_FALLBACK,
)


@dataclass
class CategoryAggregationResult:
    ok: bool
    rows_written: int = 0
    warning: str = ""


def _load_latest_native_item_forecasts(cur, store_id: str):
    """One row per (item, date) - the most recent generation for each."""
    cur.execute(
        '''
        SELECT DISTINCT ON ("otterItemSkuId", "forecastDate")
               "otterItemSkuId", "forecastDate", "predictedQty"
        FROM "ForecastMenuItem"
        WHERE "storeId" = %s
          AND "forecastSource" = 'native'
          AND "forecastDate" >= CURRENT_DATE
        ORDER BY "otterItemSkuId", "forecastDate", "generatedAt" DESC
        ''',
        (store_id,),
    )
    return cur.fetchall()


def _load_item_to_category(cur, store_id: str) -> dict[str, str]:
    """Most-recent category for each itemName at this store."""
    cur.execute(
        '''
        SELECT DISTINCT ON ("itemName") "itemName", category
        FROM "OtterMenuItem"
        WHERE "storeId" = %s AND "isModifier" = false
        ORDER BY "itemName", date DESC
        ''',
        (store_id,),
    )
    return dict(cur.fetchall())


def aggregate_categories_for_store(
    conn, *, store_id: str,
) -> CategoryAggregationResult:
    """Build ForecastDailyCategory rows for one store. Fails soft."""
    with conn.cursor() as cur:
        items = _load_latest_native_item_forecasts(cur, store_id)
    if not items:
        return CategoryAggregationResult(ok=False, warning="no_forecast_rows")

    with conn.cursor() as cur:
        item_to_cat = _load_item_to_category(cur, store_id)

    prices = compute_item_avg_prices(conn, store_id=store_id, lookback_days=60)

    # (date, category) -> revenue
    agg: dict[tuple, float] = {}
    for item_name, forecast_date, qty in items:
        category = item_to_cat.get(item_name)
        if category is None:
            continue  # skip rather than guess
        price = prices.get(item_name, AVG_PRICE_FALLBACK)
        key = (forecast_date, category)
        agg[key] = agg.get(key, 0.0) + float(qty) * price

    written = 0
    with conn.cursor() as cur:
        for (forecast_date, category), revenue in agg.items():
            cur.execute(
                '''
                INSERT INTO "ForecastDailyCategory"
                    (id, "storeId", date, "categoryName", revenue, "updatedAt")
                VALUES (%s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT ("storeId", date, "categoryName")
                DO UPDATE SET revenue = EXCLUDED.revenue,
                              "updatedAt" = CURRENT_TIMESTAMP
                ''',
                (cuid_like(), store_id, forecast_date, category, revenue),
            )
            written += 1

    return CategoryAggregationResult(ok=True, rows_written=written)
