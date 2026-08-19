"""Backfill actuals onto past forecast rows so trailing-window metrics
have ground truth to compare against.

Extracted from `ml.run_nightly` so the RECONCILE phase can be
independently tested and run.

Actuals are re-read from source for any date inside
`RERECONCILE_WINDOW_DAYS`, and only fall back to the "fill it if it is
still NULL" rule outside that window. The old behaviour filtered every
UPDATE on `actual* IS NULL` alone, which sounded idempotent but froze
each day at whatever had synced by the time the nightly ran — ~23:2x
Pacific, while the day's Otter data was still landing. Production had
all 20 most recent days understated, up to -$4,974 on 2026-08-17, and
every accuracy metric downstream was measured against that.

Do NOT filter on `"reconciledAt" IS NULL`:
the MinTrace hierarchical writer (ml/reconciliation/reconcile.py) stamps
`reconciledAt` on every horizon row nightly as the dashboard's
reconciledRevenue freshness marker, which would starve these rows of
actuals forever.

Column-mapping mirrors `scripts/backfill-reconciliation.ts`; see that
script for the rationale on which Otter columns feed which forecast
table.
"""
from __future__ import annotations

from ml.db import connect

#: Days back over which actuals are re-read from Otter every night. Must cover
#: `ml.evaluation.nightly_integration._EVAL_WINDOW_DAYS` (35) so no row the
#: evaluator scores has been abandoned by the reconciler. Otter keeps settling a
#: day for roughly two to three weeks, so 35 clears it with margin.
RERECONCILE_WINDOW_DAYS = 35

#: A day still syncing must not be zero-filled: hours that simply hadn't arrived
#: would be written as 0 orders and, being non-NULL, never revisited.
ZERO_FILL_SETTLE_DAYS = 1


def reconcile_past_forecasts(store_id: str) -> dict:
    """Backfill and correct actuals on past forecast rows for one store.

    Converges rather than freezes: inside `RERECONCILE_WINDOW_DAYS` every row
    is re-read from source each run, so a day reconciled while Otter was still
    syncing is corrected on later nights. Outside the window the actual* IS NULL
    guard still backfills anything that never got a value (`reconciledAt` is not
    a usable marker here; see module docstring). Mirrors `scripts/backfill-reconciliation.ts`
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
            f'''
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
              AND (
                    f."actualRevenue" IS NULL
                    OR f."forecastDate" >= CURRENT_DATE - {RERECONCILE_WINDOW_DAYS}
                  )
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
            f'''
            UPDATE "ForecastHourlyOrders" f
            SET "actualOrders" = o."orderCount",
                "errorPct" = CASE
                    WHEN o."orderCount" = 0 THEN NULL
                    ELSE ((f."predictedOrders" - o."orderCount") / o."orderCount") * 100
                END,
                "reconciledAt" = CURRENT_TIMESTAMP
            FROM "OtterHourlySummary" o
            WHERE f."storeId" = %s
              AND (
                    f."actualOrders" IS NULL
                    OR f."forecastDate" >= CURRENT_DATE - {RERECONCILE_WINDOW_DAYS}
                  )
              AND f."forecastDate" < CURRENT_DATE
              AND o."storeId" = f."storeId"
              AND o.date = f."forecastDate"
              AND o.hour = f."hourBucket"
            ''',
            (store_id,),
        )
        hourly_matched = cur.rowcount
        cur.execute(
            f'''
            UPDATE "ForecastHourlyOrders" f
            SET "actualOrders" = 0,
                "errorPct" = NULL,
                "reconciledAt" = CURRENT_TIMESTAMP
            WHERE f."storeId" = %s
              AND f."actualOrders" IS NULL
              AND f."forecastDate" < CURRENT_DATE - {ZERO_FILL_SETTLE_DAYS}
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
            f'''
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
              AND (
                    f."actualQty" IS NULL
                    OR f."forecastDate" >= CURRENT_DATE - {RERECONCILE_WINDOW_DAYS}
                  )
              AND f."forecastDate" < CURRENT_DATE
              AND f."storeId" = agg."storeId"
              AND f."forecastDate" = agg.date
              AND f."otterItemSkuId" = agg."itemName"
            ''',
            (store_id, store_id),
        )
        counts["menu_item"] = cur.rowcount

    return {"store_id": store_id, "ok": True, **counts}
