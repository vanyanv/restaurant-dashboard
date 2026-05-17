"""One-shot: write MlForecastEvaluation rows for trailing N days.

Usage:
    python -m ml.evaluation.backfill_evaluation --days 7
    python -m ml.evaluation.backfill_evaluation --days 7 --store-id <id>

For each active store and each target_date in [today - days + 1, today],
calls run_evaluation_pass(conn, store_id, target_date). The pure evaluator
queries reconciled history bounded by target_date and upserts one row per
(store, target) keyed on (target, storeId, modelVersion, horizonDay,
windowStart, windowEnd). Re-runs are idempotent via the existing
ON CONFLICT DO UPDATE clause in evaluator.upsert_evaluation_row.

Exits 0 if every (store, date) pair succeeded; exits 1 if any errored.
"""

from __future__ import annotations
import argparse
import datetime as dt
import logging
import sys

from ml.db import connect
from ml.evaluation.nightly_integration import run_evaluation_pass

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
_LOG = logging.getLogger("backfill_evaluation")


def _active_store_ids(conn, store_id: str | None) -> list[str]:
    with conn.cursor() as cur:
        if store_id:
            cur.execute('SELECT id FROM "Store" WHERE id = %s AND "isActive" = true', (store_id,))
        else:
            cur.execute('SELECT id FROM "Store" WHERE "isActive" = true ORDER BY id')
        return [r[0] for r in cur.fetchall()]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill MlForecastEvaluation rows for trailing days")
    parser.add_argument("--days", type=int, default=7, help="Number of trailing days to backfill (inclusive of today)")
    parser.add_argument("--store-id", default=None, help="Restrict to a single store id (default: all active stores)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.days <= 0:
        _LOG.error("--days must be >= 1")
        return 2

    today = dt.date.today()
    target_dates = [today - dt.timedelta(days=offset) for offset in range(args.days - 1, -1, -1)]

    failures: list[tuple[str, dt.date, str]] = []
    with connect() as conn:
        store_ids = _active_store_ids(conn, args.store_id)
        if not store_ids:
            _LOG.error("no active stores found%s", f" matching id={args.store_id}" if args.store_id else "")
            return 2
        _LOG.info("backfilling %d store(s) × %d date(s)", len(store_ids), len(target_dates))
        for store_id in store_ids:
            for target_date in target_dates:
                try:
                    run_evaluation_pass(conn, store_id, target_date)
                except Exception as err:
                    _LOG.exception("evaluator failed for store=%s date=%s", store_id, target_date)
                    failures.append((store_id, target_date, str(err)))

    if failures:
        _LOG.error("%d (store, date) pairs failed:", len(failures))
        for store_id, target_date, msg in failures:
            _LOG.error("  %s %s: %s", store_id, target_date, msg)
        return 1
    _LOG.info("backfill complete: %d store(s) × %d date(s)", len(store_ids), len(target_dates))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
