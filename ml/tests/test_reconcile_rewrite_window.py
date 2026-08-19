"""Regression (August 2026): reconciled actuals were frozen at their first,
partial value.

`reconcile_past_forecasts` ran nightly at ~06:2x UTC — ~23:2x Pacific — and
stamped each day's actual while the Otter sync for that day was still landing.
Every UPDATE carried `AND f."actual*" IS NULL`, so the partial number it wrote
was never corrected afterwards.

Measured on production, all 20 most recent reconciled days disagreed with
`OtterDailySummary`, always understated, worsening toward the present:
Jul 30 was -$231, Aug 14 -$2,570, Aug 17 -$4,974 ($2,204 stored against $7,178
actually taken). Every accuracy metric downstream — WAPE, interval coverage,
the seasonal-naive comparison — was computed against that corrupted truth.

The fix is a re-reconciliation window: rows inside it are rewritten from source
every night and converge on the truth as Otter finishes syncing; rows outside it
are settled and left alone.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest


def _captured_sql(monkeypatch) -> list[str]:
    """Run the reconciler against a fake cursor and return the SQL it issued."""
    from ml.evaluation import reconcile as mod

    statements: list[str] = []
    cur = MagicMock()
    cur.execute.side_effect = lambda sql, params=None: statements.append(sql)
    cur.rowcount = 0

    conn = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cur
    conn.__enter__.return_value = conn

    monkeypatch.setattr(mod, "connect", lambda: conn)
    mod.reconcile_past_forecasts("store-1")
    return statements


def test_window_covers_everything_the_evaluator_reads(monkeypatch):
    """A row the evaluator scores must never be one the reconciler has stopped
    correcting, or the metrics go stale without anything looking broken."""
    from ml.evaluation.reconcile import RERECONCILE_WINDOW_DAYS
    from ml.evaluation.nightly_integration import _EVAL_WINDOW_DAYS

    assert RERECONCILE_WINDOW_DAYS >= _EVAL_WINDOW_DAYS


def test_every_actuals_update_rewrites_inside_the_window(monkeypatch):
    from ml.evaluation.reconcile import RERECONCILE_WINDOW_DAYS

    statements = _captured_sql(monkeypatch)
    updates = {
        "revenue": next(s for s in statements if "ForecastDailyRevenue" in s),
        "hourly": next(s for s in statements if "ForecastHourlyOrders" in s),
        "menu": next(s for s in statements if "ForecastMenuItem" in s),
    }
    for name, sql in updates.items():
        assert f"CURRENT_DATE - {RERECONCILE_WINDOW_DAYS}" in sql, (
            f"{name} update never re-reads source inside the window"
        )


def test_still_backfills_rows_that_never_got_actuals(monkeypatch):
    """Outside the window the NULL guard is the only thing that fills a row, so
    a gap in an old date still heals rather than staying empty forever."""
    statements = _captured_sql(monkeypatch)
    revenue = next(s for s in statements if "ForecastDailyRevenue" in s)
    assert '"actualRevenue" IS NULL' in revenue
    assert " OR " in revenue


def test_never_keys_on_reconciled_at(monkeypatch):
    """Unchanged from the July 2026 regression: the MinTrace writer stamps
    `reconciledAt` on every horizon row nightly, so keying on it starves these
    rows of actuals forever."""
    for sql in _captured_sql(monkeypatch):
        assert '"reconciledAt" IS NULL' not in sql


def test_hourly_zero_fill_never_reruns_inside_the_window(monkeypatch):
    """The zero-fill is a fallback for hours the store genuinely never rang. If
    it re-ran inside the re-reconciliation window it would overwrite real order
    counts with 0 — the opposite of the bug being fixed."""
    statements = _captured_sql(monkeypatch)
    zero_fill = next(
        s for s in statements if "ForecastHourlyOrders" in s and '"actualOrders" = 0' in s
    )
    assert '"actualOrders" IS NULL' in zero_fill
    assert " OR " not in zero_fill


def test_hourly_zero_fill_waits_for_the_day_to_finish_syncing(monkeypatch):
    """Zero-filling a day that is still syncing writes 0 into hours that simply
    hadn't arrived yet, and the row is then real (not NULL) so nothing revisits
    it. Give the sync a day to land first."""
    statements = _captured_sql(monkeypatch)
    zero_fill = next(
        s for s in statements if "ForecastHourlyOrders" in s and '"actualOrders" = 0' in s
    )
    assert "CURRENT_DATE - 1" in zero_fill


def test_actuals_backfill_never_stamps_reconciledAt(monkeypatch):
    """`reconciledAt` belongs to the MinTrace writer, which uses it as the
    dashboard's freshness marker for `reconciledRevenue` — `isReconciledStale`
    in src/lib/forecasts/reconciliation-prefs.ts falls back to raw values when
    it is older than 48h.

    This backfiller writes `actual*` and `errorPct`; it has no business
    refreshing another subsystem's marker. It always did, but harmlessly-ish,
    because the NULL guard meant one stamp per row near the day it closed. With
    the re-reconciliation window it would restamp up to 35 days every night, so
    `isReconciledStale` would never fire again and a stale reconciledRevenue
    would be served as current.

    "Has actuals" is already expressed by `actual* IS NOT NULL`. That is what
    consumers should read, and what ml-status.ts now reads.
    """
    for sql in _captured_sql(monkeypatch):
        assert '"reconciledAt" = CURRENT_TIMESTAMP' not in sql
