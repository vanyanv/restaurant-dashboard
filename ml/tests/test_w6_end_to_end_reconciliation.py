"""End-to-end W6-8 exit gate: a synthetic store exercises the reconciliation
helpers against a real DB. Skipped when DATABASE_URL is unset."""
from __future__ import annotations

import datetime as dt
import os
import uuid

import pytest

from ml.db import connect, cuid_like


pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; end-to-end test requires a real DB",
)


@pytest.fixture
def synthetic_ready_store():
    """Clone Hollywood as a `ready` smoke store. The test seeds its own
    forecast rows so we exercise the pipeline without depending on a model run."""
    store_id = cuid_like()
    name = f"w6-smoke-{uuid.uuid4().hex[:8]}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "Store" (id, name, "ownerId", "accountId", '
            '"lifecycleStage", "updatedAt") '
            'SELECT %s, %s, "ownerId", "accountId", '
            '\'ready\'::"LifecycleStage", CURRENT_TIMESTAMP '
            'FROM "Store" WHERE name ILIKE %s LIMIT 1',
            (store_id, name, "%Hollywood"),
        )
    yield store_id
    with connect() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "MlReconciliationDaily" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "ForecastDailyCategory" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "ForecastDailyRevenue" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "ForecastMenuItem" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "OtterMenuItem" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "Store" WHERE id = %s', (store_id,))


def test_category_aggregator_writes_rows_against_real_db(synthetic_ready_store):
    """Seed a couple of OtterMenuItem rows (for category resolution + prices)
    and a couple of ForecastMenuItem rows; run the aggregator; verify rows in
    ForecastDailyCategory."""
    from ml.reconciliation.category_aggregator import aggregate_categories_for_store
    store_id = synthetic_ready_store

    # Seed OtterMenuItem (item -> category mapping AND avg price source).
    # Use +2 days to clear LA-vs-UTC date skew (Neon's CURRENT_DATE is UTC).
    today = dt.date.today()
    yesterday = today - dt.timedelta(days=1)
    forecast_date = today + dt.timedelta(days=2)
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "OtterMenuItem" '
            '(id, "storeId", date, category, "itemName", "isModifier", '
            ' "fpQuantitySold", "fpTotalSales", "tpQuantitySold", "tpTotalSales", "syncedAt") '
            'VALUES (%s, %s, %s, %s, %s, false, %s, %s, 0, 0, CURRENT_TIMESTAMP) '
            'ON CONFLICT DO NOTHING',
            (cuid_like(), store_id, yesterday, "Sandwiches", "Smoke Sandwich",
             10, 95.0),
        )
        cur.execute(
            'INSERT INTO "OtterMenuItem" '
            '(id, "storeId", date, category, "itemName", "isModifier", '
            ' "fpQuantitySold", "fpTotalSales", "tpQuantitySold", "tpTotalSales", "syncedAt") '
            'VALUES (%s, %s, %s, %s, %s, false, %s, %s, 0, 0, CURRENT_TIMESTAMP) '
            'ON CONFLICT DO NOTHING',
            (cuid_like(), store_id, yesterday, "Drinks", "Smoke Drink",
             20, 100.0),
        )

        # Seed ForecastMenuItem (native) for the future forecast_date.
        cur.execute(
            'INSERT INTO "ForecastMenuItem" '
            '(id, "storeId", "otterItemSkuId", "forecastDate", "predictedQty", '
            ' "modelVersion", "forecastSource") '
            'VALUES (%s, %s, %s, %s, %s, %s, \'native\'::"ForecastSource")',
            (cuid_like(), store_id, "Smoke Sandwich", forecast_date, 5.0, "smoke-test"),
        )
        cur.execute(
            'INSERT INTO "ForecastMenuItem" '
            '(id, "storeId", "otterItemSkuId", "forecastDate", "predictedQty", '
            ' "modelVersion", "forecastSource") '
            'VALUES (%s, %s, %s, %s, %s, %s, \'native\'::"ForecastSource")',
            (cuid_like(), store_id, "Smoke Drink", forecast_date, 8.0, "smoke-test"),
        )

    with connect() as conn:
        result = aggregate_categories_for_store(conn, store_id=store_id)

    assert result.ok, result.warning
    assert result.rows_written == 2  # Sandwiches + Drinks

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "categoryName", revenue FROM "ForecastDailyCategory" '
            'WHERE "storeId" = %s ORDER BY "categoryName"',
            (store_id,),
        )
        rows = dict(cur.fetchall())
    # Smoke Sandwich: avg price = 95/10 = 9.5. Forecast qty 5. => 47.5.
    assert abs(rows["Sandwiches"] - 47.5) < 0.01
    # Smoke Drink: avg price = 100/20 = 5.0. Forecast qty 8. => 40.
    assert abs(rows["Drinks"] - 40.0) < 0.01


def test_snapshot_writer_creates_one_row_per_store_day(synthetic_ready_store):
    """write_reconciliation_snapshot creates one row per (store, date)."""
    from ml.reconciliation.snapshot import write_reconciliation_snapshot
    with connect() as conn:
        write_reconciliation_snapshot(
            conn,
            store_id=synthetic_ready_store,
            date=dt.date.today(),
            pre_discrepancies=[-0.6, -0.5, -0.55],
            post_discrepancies=[-0.12, -0.10, -0.14],
            method_used="mint_shrink",
        )
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT "postPctDiscrepancyMedian", "methodUsed", "sampleSize" '
            'FROM "MlReconciliationDaily" WHERE "storeId" = %s',
            (synthetic_ready_store,),
        )
        rows = cur.fetchall()
    assert len(rows) == 1
    post_median, method, sample = rows[0]
    assert method == "mint_shrink"
    assert sample == 3
    # |post_discrepancies| median is 0.12.
    assert abs(post_median - 0.12) < 0.05
