"""Backfill actuals onto past forecast rows so trailing-window metrics
have ground truth to compare against.

Extracted from `ml.run_nightly` so the RECONCILE phase can be
independently tested and run. The function is idempotent — every
UPDATE filters on `"reconciledAt" IS NULL`, so re-runs only touch
rows that still lack actuals.

Column-mapping mirrors `scripts/backfill-reconciliation.ts`; see that
script for the rationale on which Otter columns feed which forecast
table.
"""
from __future__ import annotations

from ml.db import connect


def reconcile_past_forecasts(store_id: str) -> dict:
    """Backfill actuals on past forecast rows for one store.

    Idempotent — `WHERE "reconciledAt" IS NULL` ensures re-runs only touch
    rows that still lack actuals. Mirrors `scripts/backfill-reconciliation.ts`
    so the nightly pipeline keeps reconciliation current after each forecast
    write. See that script for column-mapping rationale.

    Tables:
      ForecastDailyRevenue   <- SUM(OtterDailySummary.fp/tpNetSales) per (store, date)
      ForecastHourlyOrders   <- OtterHourlySummary.orderCount per (store, date, hour);
                                closed hours on a day with any Otter coverage = 0
      ForecastMenuItem       <- SUM(OtterMenuItem.fp/tpQuantitySold) per
                                (store, date, itemName) where isModifier=false
    """
    counts = {"revenue": 0, "hourly_orders": 0, "menu_item": 0}
    with connect() as conn, conn.cursor() as cur:
        # Daily revenue. Skip dates with no OtterDailySummary rows.
        cur.execute(
            '''
            UPDATE "ForecastDailyRevenue" f
            SET "actualRevenue" = agg.actual,
                "errorPct" = CASE
                    WHEN agg.actual = 0 THEN NULL
                    ELSE ((f."predictedRevenue" - agg.actual) / agg.actual) * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT "storeId", date,
                       SUM(COALESCE("fpNetSales", 0) + COALESCE("tpNetSales", 0)) AS actual
                FROM "OtterDailySummary"
                WHERE "storeId" = %s
                GROUP BY "storeId", date
            ) agg
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND f."hourBucket" = 0
              AND f."storeId" = agg."storeId"
              AND f."forecastDate" = agg.date
            ''',
            (store_id, store_id),
        )
        counts["revenue"] = cur.rowcount

        # Hourly orders. Treat missing hours on covered dates as zero.
        # Two-step: first reconcile real-row matches; then zero-fill missing
        # hours on dates that have any Otter coverage at all.
        cur.execute(
            '''
            UPDATE "ForecastHourlyOrders" f
            SET "actualOrders" = o."orderCount",
                "errorPct" = CASE
                    WHEN o."orderCount" = 0 THEN NULL
                    ELSE ((f."predictedOrders" - o."orderCount") / o."orderCount") * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM "OtterHourlySummary" o
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND o."storeId" = f."storeId"
              AND o.date = f."forecastDate"
              AND o.hour = f."hourBucket"
            ''',
            (store_id,),
        )
        hourly_matched = cur.rowcount
        cur.execute(
            '''
            UPDATE "ForecastHourlyOrders" f
            SET "actualOrders" = 0,
                "errorPct" = NULL,
                "reconciledAt" = CURRENT_TIMESTAMP
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND EXISTS (
                  SELECT 1 FROM "OtterHourlySummary" o
                  WHERE o."storeId" = f."storeId"
                    AND o.date = f."forecastDate"
              )
            ''',
            (store_id,),
        )
        counts["hourly_orders"] = hourly_matched + cur.rowcount

        # Menu items. Skip rows where the item has no OtterMenuItem coverage on
        # that date (cannot distinguish "we didn't sell it" from "no sync").
        cur.execute(
            '''
            UPDATE "ForecastMenuItem" f
            SET "actualQty" = agg.actual,
                "errorPct" = CASE
                    WHEN agg.actual = 0 THEN NULL
                    ELSE ((f."predictedQty" - agg.actual) / agg.actual) * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT "storeId", date, "itemName",
                       SUM(COALESCE("fpQuantitySold", 0) + COALESCE("tpQuantitySold", 0)) AS actual
                FROM "OtterMenuItem"
                WHERE "storeId" = %s
                  AND "isModifier" = false
                GROUP BY "storeId", date, "itemName"
            ) agg
            WHERE f."storeId" = %s
              AND f."reconciledAt" IS NULL
              AND f."forecastDate" < CURRENT_DATE
              AND f."storeId" = agg."storeId"
              AND f."forecastDate" = agg.date
              AND f."otterItemSkuId" = agg."itemName"
            ''',
            (store_id, store_id),
        )
        counts["menu_item"] = cur.rowcount

    return {"store_id": store_id, "ok": True, **counts}
