"""End-to-end W5 exit gate: a synthetic store transitions pre_open ->
warming_up -> ready under a scripted nightly run.

This test hits the real DB if DATABASE_URL is set; otherwise it skips.
Cleans up after itself via `WHERE name LIKE 'w5-smoke-%'`.
"""
from __future__ import annotations

import os
import uuid

import pytest

from ml.db import connect, cuid_like
from ml.lifecycle import should_promote_to_ready, flip_to_ready


pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"),
    reason="DATABASE_URL not set; end-to-end test requires a real DB",
)


@pytest.fixture
def synthetic_store():
    """Create a temporary pre_open store cloned from Hollywood's owner/account
    (Hollywood is matched by suffix because the production name is
    "Chris N Eddys - Hollywood")."""
    store_id = cuid_like()
    name = f"w5-smoke-{uuid.uuid4().hex[:8]}"
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'INSERT INTO "Store" (id, name, "ownerId", "accountId", '
            '"lifecycleStage", "updatedAt") '
            'SELECT %s, %s, "ownerId", "accountId", '
            '\'pre_open\'::"LifecycleStage", CURRENT_TIMESTAMP '
            'FROM "Store" WHERE name ILIKE %s LIMIT 1',
            (store_id, name, "%Hollywood"),
        )
    yield store_id
    with connect() as conn, conn.cursor() as cur:
        cur.execute('DELETE FROM "ForecastDailyRevenue" WHERE "storeId" = %s', (store_id,))
        cur.execute('DELETE FROM "Store" WHERE id = %s', (store_id,))


def test_lifecycle_transitions_end_to_end(synthetic_store):
    store_id = synthetic_store

    # 1. pre_open: row exists with the right stage.
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "lifecycleStage" FROM "Store" WHERE id = %s', (store_id,))
        assert cur.fetchone()[0] == "pre_open"

    # 2. Ops flip -> warming_up.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'UPDATE "Store" SET "lifecycleStage" = \'warming_up\'::"LifecycleStage", '
            '"openedAt" = NOW() - INTERVAL \'10 days\', '
            '"initialTransferScalar" = 0.5 WHERE id = %s',
            (store_id,),
        )

    # 3. Native model beats transfer by 6%, n=70 -> should promote.
    assert should_promote_to_ready(native_wape=0.188, transfer_wape=0.200, sample_size=70)

    # 4. Apply the flip and verify.
    with connect() as conn:
        flip_to_ready(conn, store_id=store_id)
    with connect() as conn, conn.cursor() as cur:
        cur.execute('SELECT "lifecycleStage" FROM "Store" WHERE id = %s', (store_id,))
        assert cur.fetchone()[0] == "ready"

    # 5. Counter-test: native barely beats transfer (4%) -> should NOT promote.
    assert not should_promote_to_ready(native_wape=0.192, transfer_wape=0.200, sample_size=70)


def test_transfer_writer_against_real_hollywood_data(synthetic_store):
    """Run the transfer writer against the real DB. Uses initial_scalar fallback
    since the synthetic store has no actuals. Verifies row count > 0 if
    Hollywood has any future-dated forecasts in the DB, ok=False otherwise
    (fails soft per spec)."""
    from ml.transfer.hollywood_prior import write_transfer_forecasts_for_store

    # Resolve real Hollywood store id by suffix.
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT id FROM "Store" WHERE name ILIKE %s AND "isActive" = true '
            'AND "lifecycleStage" = \'ready\'::"LifecycleStage" LIMIT 1',
            ("%Hollywood",),
        )
        row = cur.fetchone()
    if row is None:
        pytest.skip("no Hollywood store with lifecycleStage=ready in this DB")
    hollywood_id = row[0]

    with connect() as conn:
        result = write_transfer_forecasts_for_store(
            conn,
            new_store_id=synthetic_store,
            hollywood_store_id=hollywood_id,
            model_version="transfer-w5-smoke",
            initial_scalar=0.5,
            horizon_days=14,
        )

    if not result.ok:
        # Acceptable per fail-soft contract; assert the warning is the expected one.
        assert result.warning in {"hollywood_has_no_recent_forecasts"} or \
            result.warning.startswith("scalar_unavailable"), result.warning
        return

    # Otherwise verify the rows landed with forecastSource = 'transfer'.
    assert result.revenue_rows_written > 0
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            'SELECT COUNT(*) FROM "ForecastDailyRevenue" '
            'WHERE "storeId" = %s AND "forecastSource" = \'transfer\'',
            (synthetic_store,),
        )
        (count,) = cur.fetchone()
    assert count == result.revenue_rows_written
